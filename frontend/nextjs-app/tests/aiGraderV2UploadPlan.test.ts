import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";

import { createSpeedsterUploadPlanHandler } from "../pages/api/admin/ai-grader-v2/upload-plan";

const SESSION_ID = "speedster-session-123456789";
const RECAPTURE_ID = "00000000-0000-4000-8000-000000000007";
const CHECKSUM = "a".repeat(64);
const BYTE_SIZE = 42;

function request(body: unknown, method = "POST"): NextApiRequest {
  return { method, body, query: {}, headers: {} } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: any; allow?: string } = {};
  const res = {
    setHeader(name: string, value: string) { if (name === "Allow") state.allow = value; return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function dependencies(workflowState = "DRAFT") {
  const calls = {
    heads: [] as string[],
    uploads: [] as Array<{ key: string; checksumSha256?: string }>,
    reads: [] as string[],
    verifies: [] as unknown[],
    storageReady: 0,
  };
  return {
    calls,
    deps: {
      async requireAdminSession() {
        return {
          sessionId: "admin-session-1",
          tokenHash: "a".repeat(64),
          authority: "local-database" as const,
          user: { id: "admin-1", phone: null, displayName: null },
        };
      },
      async findOwnedSession(id: string, userId: string) {
        assert.equal(userId, "admin-1");
        return { id, workflowState };
      },
      storageReady() { calls.storageReady += 1; return true; },
      async presignUpload(key: string, _contentType: string, checksumSha256?: string) {
        calls.uploads.push({ key, checksumSha256 });
        return `https://upload.example.test/${key}`;
      },
      async presignRead(key: string) { calls.reads.push(key); return `read:${key}`; },
      async headObject(key: string) {
        calls.heads.push(key);
        return {
          storageKey: key,
          byteSize: 42,
          contentType: "image/jpeg",
          metadata: {},
          checksumSha256: null,
        };
      },
      async verifyObject(input: unknown) {
        calls.verifies.push(input);
        return {
          ok: true,
          byteSize: BYTE_SIZE,
          contentType: "image/jpeg",
          checksumSha256: CHECKSUM,
          checksumSource: "server_stream" as const,
        };
      },
      randomUuid() { return RECAPTURE_ID; },
    },
  };
}

test("upload plan issues a server-namespaced targeted original only for an owned DRAFT", async () => {
  const { calls, deps } = dependencies();
  const handler = createSpeedsterUploadPlanHandler(deps);
  const { state, res } = response();
  await handler(request({
    sessionId: SESSION_ID,
    side: "FRONT",
    kind: "ORIGINAL",
    contentType: "image/jpeg",
    checksumSha256: CHECKSUM,
    byteSize: BYTE_SIZE,
    targetedRecapture: true,
  }), res);

  const expected = `ai-grader-v2/admin-1/${SESSION_ID}/original/recapture-${RECAPTURE_ID}/front.jpg`;
  assert.equal(state.status, 200);
  assert.equal(state.body.storageKey, expected);
  assert.deepEqual(calls.uploads, [{ key: expected, checksumSha256: CHECKSUM }]);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.heads, []);
  assert.equal(state.body.uploadMethod, "PUT");
  assert.equal(state.body.uploadHeaders["x-amz-acl"], "private");
  assert.equal(state.body.checksumSha256, CHECKSUM);
  assert.equal(state.body.byteSize, BYTE_SIZE);
});

test("initial original upload key is immutable and content-addressed by the exact planned checksum", async () => {
  const { calls, deps } = dependencies();
  const handler = createSpeedsterUploadPlanHandler(deps);
  const { state, res } = response();
  await handler(request({
    sessionId: SESSION_ID,
    side: "BACK",
    kind: "ORIGINAL",
    contentType: "image/png",
    checksumSha256: CHECKSUM,
    byteSize: BYTE_SIZE,
  }), res);
  const expected = `ai-grader-v2/admin-1/${SESSION_ID}/original/sha256-${CHECKSUM}/back.png`;
  assert.equal(state.status, 200);
  assert.equal(state.body.storageKey, expected);
  assert.deepEqual(calls.uploads, [{ key: expected, checksumSha256: CHECKSUM }]);
});

test("upload plan never presigns or checks storage for CAPTURED or COMPLETED history", async () => {
  for (const workflowState of ["CAPTURED", "COMPLETED"]) {
    const { calls, deps } = dependencies(workflowState);
    const handler = createSpeedsterUploadPlanHandler(deps);
    const { state, res } = response();
    await handler(request({
      sessionId: SESSION_ID,
      side: "BACK",
      kind: "ORIGINAL",
      contentType: "image/png",
      checksumSha256: CHECKSUM,
      byteSize: BYTE_SIZE,
    }), res);
    assert.equal(state.status, 409);
    assert.equal(calls.storageReady, 0);
    assert.deepEqual(calls.uploads, []);
    assert.deepEqual(calls.reads, []);
    assert.deepEqual(calls.heads, []);
  }
});

test("unknown upload kind is rejected before any storage or presign capability is used", async () => {
  const { calls, deps } = dependencies();
  const handler = createSpeedsterUploadPlanHandler(deps);
  const { state, res } = response();
  await handler(request({ sessionId: SESSION_ID, side: "FRONT", kind: "PREPRAED", contentType: "image/jpeg" }), res);
  assert.equal(state.status, 400);
  assert.deepEqual(calls.heads, []);
  assert.deepEqual(calls.uploads, []);
  assert.deepEqual(calls.reads, []);
});

test("original verification binds owned storage key, bytes, type, and SHA before issuing a read URL", async () => {
  const { calls, deps } = dependencies();
  const handler = createSpeedsterUploadPlanHandler(deps);
  const storageKey = `ai-grader-v2/admin-1/${SESSION_ID}/original/front.jpg`;
  const { state, res } = response();
  await handler(request({
    sessionId: SESSION_ID,
    side: "FRONT",
    kind: "ORIGINAL_VERIFY",
    contentType: "image/jpeg",
    storageKey,
    checksumSha256: CHECKSUM,
    byteSize: BYTE_SIZE,
  }), res);

  assert.equal(state.status, 200);
  assert.deepEqual(calls.verifies, [{
    storageKey,
    expectedByteSize: BYTE_SIZE,
    expectedChecksumSha256: CHECKSUM,
  }]);
  assert.deepEqual(calls.reads, [storageKey]);
  assert.deepEqual(state.body, { storageKey, readUrl: `read:${storageKey}` });

  const mismatch = response();
  const mismatchHandler = createSpeedsterUploadPlanHandler({
    ...deps,
    async verifyObject() {
      return {
        ok: false,
        byteSize: BYTE_SIZE,
        contentType: "image/jpeg",
        checksumSha256: "b".repeat(64),
        checksumSource: "server_stream" as const,
      };
    },
  });
  await mismatchHandler(request({
    sessionId: SESSION_ID,
    side: "FRONT",
    kind: "ORIGINAL_VERIFY",
    contentType: "image/jpeg",
    storageKey,
    checksumSha256: CHECKSUM,
    byteSize: BYTE_SIZE,
  }), mismatch.res);
  assert.equal(mismatch.state.status, 409);
});

test("prepared plan HEADs the exact source and derives all five outputs in that same generation", async () => {
  const { calls, deps } = dependencies();
  const sourceImageStorageKey = `ai-grader-v2/admin-1/${SESSION_ID}/original/recapture-${RECAPTURE_ID}/back.webp`;
  const handler = createSpeedsterUploadPlanHandler(deps);
  const { state, res } = response();
  await handler(request({ sessionId: SESSION_ID, side: "BACK", kind: "PREPARED", sourceImageStorageKey }), res);

  assert.equal(state.status, 200);
  assert.deepEqual(calls.heads, [sourceImageStorageKey]);
  assert.equal(calls.uploads.length, 0, "Prepared PUT capability must remain server-only");
  assert.equal(calls.reads.length, 5);
  assert.ok(calls.reads.every((key) => key.includes(`/prepared/back/recapture-${RECAPTURE_ID}/`)));
  assert.doesNotMatch(JSON.stringify(state.body), /uploadUrl/);
  assert.deepEqual(Object.keys(state.body.outputs).sort(), ["DIRECTIONAL", "INSPECTION", "MICRO_DEFECT", "NORMALIZED", "RECTIFIED"]);
});

test("prepared plan rejects cross-side sources and distinguishes proven absence from provider failure", async () => {
  const { calls, deps } = dependencies();
  const crossSide = `ai-grader-v2/admin-1/${SESSION_ID}/original/recapture-${RECAPTURE_ID}/front.jpg`;
  const handler = createSpeedsterUploadPlanHandler(deps);
  const rejected = response();
  await handler(request({ sessionId: SESSION_ID, side: "BACK", kind: "PREPARED", sourceImageStorageKey: crossSide }), rejected.res);
  assert.equal(rejected.state.status, 400);
  assert.deepEqual(calls.heads, []);
  assert.deepEqual(calls.uploads, []);

  const exact = `ai-grader-v2/admin-1/${SESSION_ID}/original/recapture-${RECAPTURE_ID}/back.jpg`;
  const missing = createSpeedsterUploadPlanHandler({
    ...deps,
    async headObject() { throw Object.assign(new Error("missing"), { name: "NoSuchKey" }); },
  });
  const missingResponse = response();
  await missing(request({ sessionId: SESSION_ID, side: "BACK", kind: "PREPARED", sourceImageStorageKey: exact }), missingResponse.res);
  assert.equal(missingResponse.state.status, 409);
  assert.match(missingResponse.state.body.message, /source image is not ready/);

  const provider = createSpeedsterUploadPlanHandler({
    ...deps,
    async headObject() { throw Object.assign(new Error("provider auth rejected HEAD"), { $metadata: { httpStatusCode: 503 } }); },
  });
  const providerResponse = response();
  await provider(request({ sessionId: SESSION_ID, side: "BACK", kind: "PREPARED", sourceImageStorageKey: exact }), providerResponse.res);
  assert.equal(providerResponse.state.status, 500);
  assert.doesNotMatch(providerResponse.state.body.message, /source image is not ready/);
});
