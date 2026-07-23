import test from "node:test";
import assert from "node:assert/strict";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  createAiGraderCalibrationActivationApiHandler,
} from "../lib/server/aiGraderCalibrationActivationApi";
import {
  createAiGraderCalibrationStartAuthorityApiHandler,
} from "../lib/server/aiGraderCalibrationStartAuthorityApi";

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
    async resolveTrustedRegistry() {
      return {
        registry: { registryRevision: "a".repeat(64) },
        status: { ok: true, registryRevision: "a".repeat(64), active: null, pending: null, authority: null },
      };
    },
    async list() { return { registryRevision: "a".repeat(64) }; },
    async status() { return { registryRevision: "a".repeat(64), active: null, pending: null, authority: null }; },
    async requestObservationAuthority() { return { observationAuthority: { observationId: "observation-1" } }; },
    async requestActivation() { return { registryRevision: "a".repeat(64), activation: {}, pendingAuthority: {} }; },
    async completeActivation() { return { registryRevision: "a".repeat(64), activation: {}, authority: {} }; },
    async failActivation() { return { registryRevision: "a".repeat(64), activation: {} }; },
    ...overrides,
  } as any;
}

test("hosted trusted resolver accepts no browser rig choice and performs no write", async () => {
  let ordinaryAuth = 0;
  let freshAuth = 0;
  let resolved = 0;
  let writeCalled = false;
  const runtime = createAiGraderCalibrationActivationApiHandler({
    async requireAdminSession() {
      ordinaryAuth += 1;
      return { user: { id: "admin-exact" } };
    },
    async requireFreshAdminSession() {
      freshAuth += 1;
      return { user: { id: "admin-exact" } };
    },
    service: service({
      async resolveTrustedRegistry() {
        resolved += 1;
        return {
          registry: { rigId: "rig-hosted", registryRevision: "a".repeat(64) },
          status: { ok: true, registryRevision: "a".repeat(64), active: null, pending: null, authority: null },
        };
      },
      async requestActivation() {
        writeCalled = true;
        return {};
      },
    }),
  });

  const result = response();
  await runtime(request("resolve-trusted", {}), result.res);
  assert.equal(result.state.status, 200);
  assert.equal(result.state.body.registry.rigId, "rig-hosted");
  assert.equal(resolved, 1);
  assert.equal(ordinaryAuth, 1);
  assert.equal(freshAuth, 0);
  assert.equal(writeCalled, false);

  for (const forbidden of [{ rigId: "browser-rig" }, { snapshotId: "browser-snapshot" }]) {
    const rejected = response();
    await runtime(request("resolve-trusted", forbidden), rejected.res);
    assert.equal(rejected.state.status, 400);
  }
  assert.equal(resolved, 1);
});

test("hosted activation routes own action, actor, hashes, and state while writes require fresh human admin", async () => {
  const calls: Array<{ input: Record<string, unknown>; actor: string }> = [];
  let ordinaryAuth = 0;
  let freshAuth = 0;
  const runtime = createAiGraderCalibrationActivationApiHandler({
    async requireAdminSession() {
      ordinaryAuth += 1;
      return { user: { id: "admin-exact" } };
    },
    async requireFreshAdminSession() {
      freshAuth += 1;
      return { user: { id: "admin-exact" } };
    },
    service: service({
      async requestActivation(input: Record<string, unknown>, actor: string) {
        calls.push({ input, actor });
        return { registryRevision: "a".repeat(64), activation: { state: "PENDING" }, pendingAuthority: { activationId: "activation-1" } };
      },
    }),
  });

  const listed = response();
  await runtime(request("list", { rigId: "rig-1", includeIncomplete: true }), listed.res);
  assert.equal(listed.state.status, 200);
  assert.equal(ordinaryAuth, 1);
  assert.equal(freshAuth, 0);

  const activated = response();
  const observationAuthority = { observationId: "observation-1" };
  const workstationObservation = { observationId: "observation-1" };
  await runtime(request("activate", {
    rigId: "rig-1",
    snapshotId: "snapshot-1",
    expectedRegistryRevision: "b".repeat(64),
    idempotencyKey: "request-1",
    reason: "exact profile selected by human",
    observationAuthority,
    workstationObservation,
  }), activated.res);
  assert.equal(activated.state.status, 201);
  assert.equal(freshAuth, 1);
  assert.deepEqual(calls[0], {
    input: {
      rigId: "rig-1",
      snapshotId: "snapshot-1",
      expectedRegistryRevision: "b".repeat(64),
      idempotencyKey: "request-1",
      reason: "exact profile selected by human",
      observationAuthority,
      workstationObservation,
      action: "activate",
    },
    actor: "admin-exact",
  });
  assert.equal(activated.state.body.pendingAuthority.activationId, "activation-1");

  for (const forbidden of [
    { action: "reactivate" },
    { actorUserId: "spoofed" },
    { activationHash: "c".repeat(64) },
    { state: "ACTIVE" },
    { storageKey: "private/object/key" },
  ]) {
    const rejected = response();
    await runtime(request("activate", {
      rigId: "rig-1",
      snapshotId: "snapshot-1",
      expectedRegistryRevision: "b".repeat(64),
      idempotencyKey: "request-2",
      reason: "attempted browser declaration",
      observationAuthority,
      workstationObservation,
      ...forbidden,
    }), rejected.res);
    assert.equal(rejected.state.status, 400);
  }
  assert.equal(calls.length, 1);
});

test("observation authority requires fresh human admin and performs no activation write", async () => {
  let observations = 0;
  let activations = 0;
  const runtime = createAiGraderCalibrationActivationApiHandler({
    async requireAdminSession() { return { user: { id: "admin" } }; },
    async requireFreshAdminSession() { return { user: { id: "fresh-admin" } }; },
    service: service({
      async requestObservationAuthority(input: Record<string, unknown>) {
        observations += 1;
        assert.deepEqual(input, {
          rigId: "rig-1",
          snapshotId: "snapshot-1",
          expectedRegistryRevision: "b".repeat(64),
        });
        return { observationAuthority: { observationId: "observation-1" } };
      },
      async requestActivation() {
        activations += 1;
        return {};
      },
    }),
  });
  const result = response();
  await runtime(request("observe", {
    rigId: "rig-1",
    snapshotId: "snapshot-1",
    expectedRegistryRevision: "b".repeat(64),
  }), result.res);
  assert.equal(result.state.status, 200);
  assert.equal(result.state.body.observationAuthority.observationId, "observation-1");
  assert.equal(observations, 1);
  assert.equal(activations, 0);
});

test("reactivate is explicit and mutation is denied when fresh-human step-up fails", async () => {
  let called = false;
  const runtime = createAiGraderCalibrationActivationApiHandler({
    async requireAdminSession() { return { user: { id: "admin" } }; },
    async requireFreshAdminSession() {
      throw Object.assign(new Error("Fresh human-admin authentication required"), { statusCode: 403 });
    },
    service: service({
      async requestActivation() { called = true; return {}; },
    }),
  });
  const result = response();
  await runtime(request("reactivate", {
    rigId: "rig-1",
    snapshotId: "snapshot-old",
    priorActivationId: "activation-old",
    expectedRegistryRevision: "b".repeat(64),
    idempotencyKey: "reactivate-1",
    reason: "explicit historical reactivation",
  }), result.res);
  assert.equal(result.state.status, 403);
  assert.equal(called, false);
});

test("Start New Card authority is human-only, exact-scoped, and fail-closed", async () => {
  let scope: string[] = [];
  const runtime = createAiGraderCalibrationStartAuthorityApiHandler({
    async requireHumanActor() { return { type: "human_operator", user: { id: "human-1" } }; },
    service: {
      async readStartAuthority(tenantId: string, rigId: string) {
        scope = [tenantId, rigId];
        return { registryRevision: "a".repeat(64), authority: {} as any, activation: {} as any };
      },
    },
  });
  const valid = response();
  await runtime({ method: "POST", body: { tenantId: "tenant-1", rigId: "rig-1" } } as NextApiRequest, valid.res);
  assert.equal(valid.state.status, 200);
  assert.deepEqual(scope, ["tenant-1", "rig-1"]);

  const injected = response();
  await runtime({
    method: "POST",
    body: { tenantId: "tenant-1", rigId: "rig-1", activationId: "browser-choice" },
  } as NextApiRequest, injected.res);
  assert.equal(injected.state.status, 400);

  const deniedRuntime = createAiGraderCalibrationStartAuthorityApiHandler({
    async requireHumanActor() {
      throw Object.assign(new Error("Service accounts cannot start cards"), { statusCode: 403 });
    },
    service: { async readStartAuthority() { throw new Error("must not run"); } },
  });
  const denied = response();
  await deniedRuntime({ method: "POST", body: { tenantId: "tenant-1", rigId: "rig-1" } } as NextApiRequest, denied.res);
  assert.equal(denied.state.status, 403);
});
