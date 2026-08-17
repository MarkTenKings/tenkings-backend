import test from "node:test";
import assert from "node:assert/strict";
import type { NextApiRequest, NextApiResponse } from "next";
import { VaultApiError } from "../lib/server/vaultV1/http";
import {
  handleVaultMachineAction,
  type VaultMachineActionDependencies,
} from "../lib/server/vaultV1/machineActions";

const MACHINE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_MACHINE_ID = "00000000-0000-4000-8000-000000000002";
const MACHINE_SECRET = "vault-machine-test-secret-0000000000000001";

type CapturedResponse = {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  response: NextApiResponse;
};

function capturedResponse(): CapturedResponse {
  const captured: CapturedResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
    response: undefined as unknown as NextApiResponse,
  };
  captured.response = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    setHeader(name: string, value: string | readonly string[]) {
      captured.headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
      return this;
    },
  } as unknown as NextApiResponse;
  return captured;
}

function event(sequence: number, eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    eventId,
    schemaVersion: 1,
    machineId: MACHINE_ID,
    sequence,
    type: "PUBLIC_ACTIVITY_RECORDED",
    mode: "PRODUCTION",
    occurredAt: `2026-08-17T01:00:0${sequence}.000Z`,
    payload: { observedAt: `2026-08-17T01:00:0${sequence}.000Z` },
    ...overrides,
  };
}

function routeRequest(input: {
  action: "events:batch" | "staff-grants:pull" | string;
  method: string;
  machineId?: string;
  headers?: Record<string, string>;
  body?: unknown;
  afterGrantVersion?: string;
}): NextApiRequest {
  const machineId = input.machineId ?? MACHINE_ID;
  return {
    method: input.method,
    url: `/api/vault/v1/machines/${machineId}/${input.action}`,
    headers: {
      "x-vault-contract-version": "1",
      "content-type": "application/json",
      authorization: `VaultMachine ${MACHINE_SECRET}`,
      ...input.headers,
    },
    query: {
      machineId,
      action: [input.action],
      ...(input.afterGrantVersion === undefined ? {} : { afterGrantVersion: input.afterGrantVersion }),
    },
    body: input.body,
  } as unknown as NextApiRequest;
}

type StoredEvent = { eventId: string; sequence: bigint; payloadDigest: string };

function fakeDependencies() {
  const eventsById = new Map<string, StoredEvent>();
  const eventsBySequence = new Map<bigint, StoredEvent>();
  const audits: unknown[] = [];
  const authenticatedPaths: string[] = [];
  const staffQueries: any[] = [];
  let machineSequence = 0n;
  const grant = {
    grantId: "00000000-0000-4000-8000-000000000101",
    userId: "staff-1",
    machineId: MACHINE_ID,
    role: "TECHNICIAN",
    grantVersion: 5,
    verifierVersion: 1,
    verifierHash: "a".repeat(64),
    verifierAlgorithm: "scrypt",
    verifierParameters: { N: 16384, r: 8, p: 1, keyLength: 64 },
    validFrom: new Date("2026-08-17T00:00:00.000Z"),
    expiresAt: new Date("2026-09-17T00:00:00.000Z"),
    revokedAt: null,
  };
  const tx = {
    $queryRaw: async () => [{ id: MACHINE_ID }],
    vaultMachineEvent: {
      findUnique: async ({ where }: any) => {
        if (where.machineId_eventId) return eventsById.get(where.machineId_eventId.eventId) ?? null;
        if (where.machineId_sequence) return eventsBySequence.get(where.machineId_sequence.sequence) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        const stored = { eventId: data.eventId, sequence: data.sequence, payloadDigest: data.payloadDigest };
        eventsById.set(data.eventId, stored);
        eventsBySequence.set(data.sequence, stored);
        return stored;
      },
    },
    vaultMachine: {
      findUnique: async () => ({ lastEventSequence: machineSequence }),
      update: async ({ data }: any) => {
        machineSequence = data.lastEventSequence;
        return { id: MACHINE_ID };
      },
    },
  };
  const prismaClient = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    vaultAdminAuditEvent: { create: async ({ data }: any) => { audits.push(data); return data; } },
    vaultStaffMachineAccess: {
      findMany: async (query: any) => {
        staffQueries.push(query);
        return query.where.grantVersion.gt < grant.grantVersion ? [grant] : [];
      },
    },
  };
  const dependencies = {
    prismaClient,
    authenticateMachine: async (req: NextApiRequest, pathMachineId: string) => {
      authenticatedPaths.push(pathMachineId);
      if (req.headers.authorization !== `VaultMachine ${MACHINE_SECRET}`) {
        throw new VaultApiError(401, "MACHINE_AUTH_REQUIRED", "A VaultMachine credential is required");
      }
      if (pathMachineId !== MACHINE_ID) {
        throw new VaultApiError(403, "MACHINE_PATH_BINDING_FAILED", "Machine credential does not match this path");
      }
      return {
        machine: { id: MACHINE_ID, status: "ACTIVE", currentCredentialVersion: 1 },
        credentialId: "credential-1",
        credentialVersion: 1,
      };
    },
    projectEvent: async () => undefined,
  } as unknown as VaultMachineActionDependencies;
  return {
    dependencies,
    eventsBySequence,
    audits,
    authenticatedPaths,
    staffQueries,
    machineSequence: () => machineSequence,
  };
}

test("Windows-safe catch-all preserves the events:batch URL, POST enforcement, contract, JSON, and body limit", async () => {
  const fake = fakeDependencies();
  const body = { contractVersion: 1, events: [event(1, "00000000-0000-4000-8000-000000000011")] };

  const wrongMethod = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "GET", body }), wrongMethod.response, fake.dependencies);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, "POST");

  const wrongContract = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body, headers: { "x-vault-contract-version": "2" } }), wrongContract.response, fake.dependencies);
  assert.equal(wrongContract.statusCode, 426);
  assert.equal(wrongContract.body.error.code, "UNSUPPORTED_CONTRACT_VERSION");

  const wrongJson = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body, headers: { "content-type": "text/plain" } }), wrongJson.response, fake.dependencies);
  assert.equal(wrongJson.statusCode, 415);

  const jsonPrefixOnly = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body, headers: { "content-type": "application/jsonp" } }), jsonPrefixOnly.response, fake.dependencies);
  assert.equal(jsonPrefixOnly.statusCode, 415);

  const tooLarge = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body, headers: { "content-length": String(8 * 1024 * 1024 + 1) } }), tooLarge.response, fake.dependencies);
  assert.equal(tooLarge.statusCode, 413);

  const malformed = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body: {} }), malformed.response, fake.dependencies);
  assert.equal(malformed.statusCode, 400);
});

test("events:batch authenticates against the exact path and rejects event/path mismatch", async () => {
  const fake = fakeDependencies();
  const body = { contractVersion: 1, events: [event(1, "00000000-0000-4000-8000-000000000021")] };

  const missingCredential = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body, headers: { authorization: "" } }), missingCredential.response, fake.dependencies);
  assert.equal(missingCredential.statusCode, 401);

  const wrongPath = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", machineId: OTHER_MACHINE_ID, body }), wrongPath.response, fake.dependencies);
  assert.equal(wrongPath.statusCode, 403);
  assert.equal(wrongPath.body.error.code, "MACHINE_PATH_BINDING_FAILED");

  const wrongEventMachine = capturedResponse();
  await handleVaultMachineAction(routeRequest({
    action: "events:batch",
    method: "POST",
    body: { contractVersion: 1, events: [event(1, "00000000-0000-4000-8000-000000000022", { machineId: OTHER_MACHINE_ID })] },
  }), wrongEventMachine.response, fake.dependencies);
  assert.equal(wrongEventMachine.statusCode, 403);
  assert.equal(wrongEventMachine.body.error.code, "EVENT_MACHINE_MISMATCH");
  assert.deepEqual(fake.authenticatedPaths, [MACHINE_ID, OTHER_MACHINE_ID, MACHINE_ID]);
});

test("events:batch remains idempotent and rejects reuse of an event ID with a different digest", async () => {
  const fake = fakeDependencies();
  const eventId = "00000000-0000-4000-8000-000000000031";
  const body = { contractVersion: 1, events: [event(1, eventId)] };

  const first = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body }), first.response, fake.dependencies);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.acknowledgedEventIds, [eventId]);
  assert.equal(fake.machineSequence(), 1n);

  const duplicate = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body }), duplicate.response, fake.dependencies);
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(duplicate.body.acknowledgedEventIds, [eventId]);
  assert.equal(fake.eventsBySequence.size, 1);

  const conflict = capturedResponse();
  const changed = event(1, eventId, { payload: { observedAt: "2026-08-17T02:00:00.000Z" } });
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body: { contractVersion: 1, events: [changed] } }), conflict.response, fake.dependencies);
  assert.equal(conflict.statusCode, 207);
  assert.equal(conflict.body.rejected[0].code, "EVENT_ID_PAYLOAD_CONFLICT");
  assert.equal(fake.audits.length, 1);
});

test("events:batch acknowledges only the contiguous accepted prefix after a poison event", async () => {
  const fake = fakeDependencies();
  const firstId = "00000000-0000-4000-8000-000000000041";
  const poisonId = "00000000-0000-4000-8000-000000000042";
  const blockedId = "00000000-0000-4000-8000-000000000043";
  const body = {
    contractVersion: 1,
    events: [
      event(1, firstId),
      event(2, poisonId, { type: "FUTURE_UNREVIEWED_EVENT", payload: {} }),
      event(3, blockedId),
    ],
  };
  const response = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "events:batch", method: "POST", body }), response.response, fake.dependencies);
  assert.equal(response.statusCode, 207);
  assert.deepEqual(response.body.acknowledgedEventIds, [firstId]);
  assert.deepEqual(response.body.rejected.map((item: any) => [item.eventId, item.code]), [
    [poisonId, "EVENT_TYPE_UNSUPPORTED"],
    [blockedId, "CONTIGUOUS_PREFIX_BLOCKED"],
  ]);
  assert.equal(response.body.partial, true);
  assert.equal(fake.machineSequence(), 1n);
});

test("Windows-safe catch-all preserves the GET staff-grants:pull URL, authorization, query, and response", async () => {
  const fake = fakeDependencies();

  const wrongMethod = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "staff-grants:pull", method: "POST" }), wrongMethod.response, fake.dependencies);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, "GET");

  const wrongContract = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "staff-grants:pull", method: "GET", headers: { "x-vault-contract-version": "9" } }), wrongContract.response, fake.dependencies);
  assert.equal(wrongContract.statusCode, 426);

  const wrongPath = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "staff-grants:pull", method: "GET", machineId: OTHER_MACHINE_ID }), wrongPath.response, fake.dependencies);
  assert.equal(wrongPath.statusCode, 403);

  const success = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "staff-grants:pull", method: "GET", afterGrantVersion: "4" }), success.response, fake.dependencies);
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.grants.length, 1);
  assert.equal(success.body.grants[0].machineId, MACHINE_ID);
  assert.equal(success.body.latestGrantVersion, 5);
  assert.equal(success.body.hasMore, false);
  assert.equal(fake.staffQueries[0].where.machineId, MACHINE_ID);
  assert.equal(fake.staffQueries[0].where.grantVersion.gt, 4);
});

test("unknown or multi-segment catch-all machine actions fail closed", async () => {
  const fake = fakeDependencies();
  const unknown = capturedResponse();
  await handleVaultMachineAction(routeRequest({ action: "unknown", method: "GET" }), unknown.response, fake.dependencies);
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.body.error.code, "VAULT_MACHINE_ACTION_NOT_FOUND");

  const request = routeRequest({ action: "events:batch", method: "POST", body: {} });
  request.query.action = ["events:batch", "extra"];
  const multiSegment = capturedResponse();
  await handleVaultMachineAction(request, multiSegment.response, fake.dependencies);
  assert.equal(multiSegment.statusCode, 404);
});
