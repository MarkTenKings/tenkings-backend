import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderNfcApiHandler, type AiGraderNfcApiDependencies } from "../lib/server/aiGraderNfcApi";

function request(input: {
  method?: string;
  action: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  return {
    method: input.method ?? "POST",
    query: { action: input.action.split("/"), ...(input.query ?? {}) },
    body: input.body,
    headers: input.headers ?? {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
}

function response() {
  let statusCode = 200;
  let payload: unknown;
  const headers = new Map<string, unknown>();
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    },
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
  } as unknown as NextApiResponse;
  return { res, read: () => ({ statusCode, payload, headers }) };
}

function deps(overrides: Partial<AiGraderNfcApiDependencies> = {}) {
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const operation = (name: string) => async (input: Record<string, unknown>) => {
    calls.push({ operation: name, input });
    return { status: name === "status" ? "missing" : "reserved" };
  };
  const value: AiGraderNfcApiDependencies = {
    env: {
      AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings",
      AI_GRADER_OPERATOR_USER_IDS: "operator-1",
    },
    disableRateLimitForTests: true,
    requireUserSession: async () => ({
      id: "session-1",
      tokenHash: "redacted-session-hash",
      user: { id: "operator-1", phone: null, displayName: "Operator", avatarUrl: null },
    }),
    init: operation("init") as AiGraderNfcApiDependencies["init"],
    complete: operation("complete") as AiGraderNfcApiDependencies["complete"],
    status: operation("status") as AiGraderNfcApiDependencies["status"],
    revoke: operation("revoke") as AiGraderNfcApiDependencies["revoke"],
    replace: operation("replace") as AiGraderNfcApiDependencies["replace"],
    ...overrides,
  };
  return { value, calls };
}

test("NFC status uses explicit human NFC scope and returns only the runtime safe result", async () => {
  const runtime = deps();
  const handler = createAiGraderNfcApiHandler(runtime.value);
  const output = response();
  await handler(request({ method: "GET", action: "status", query: { reportId: "report-1" } }), output.res);
  const result = output.read();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { ok: true, operation: "aiGraderNfcStatus", result: { status: "missing" } });
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(runtime.calls[0].input.actorUserId, "operator-1");
  assert.equal(runtime.calls[0].input.tenantId, "ten-kings");
});

test("NFC init ignores caller redirect/public tag fields and passes server-owned reservation inputs", async () => {
  const runtime = deps();
  const handler = createAiGraderNfcApiHandler(runtime.value);
  const output = response();
  await handler(
    request({
      action: "init",
      body: {
        reportId: "report-1",
        idempotencyKey: "program-report-1",
        redirectUrl: "https://attacker.invalid/",
        publicTagId: "caller-selected",
      },
    }),
    output.res,
  );
  assert.equal(output.read().statusCode, 200);
  assert.equal(runtime.calls.length, 1);
  assert.equal("redirectUrl" in runtime.calls[0].input, false);
  assert.equal("publicTagId" in runtime.calls[0].input, false);
  assert.equal(runtime.calls[0].input.attemptTtlSeconds, 300);
});

test("NFC complete rejects open redirects, query strings, wrong chip type, and malformed UID fingerprints", async () => {
  const base = {
    reportId: "report-1",
    cardAssetId: "card-1",
    itemId: "item-1",
    certId: "TK-AIG-1",
    publicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
    attemptId: "AttemptAbcdefghijklmnop",
    attemptToken: "TokenTokenTokenTokenTokenTokenTokenToken",
    idempotencyKey: "complete-report-1",
    chipType: "NTAG215",
    normalizedUrl: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
    uidFingerprintSha256: "a".repeat(64),
    readbackPayloadSha256: "b".repeat(64),
    readerResultCode: "write_verified_pcsc_readback",
    helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v1",
  };
  for (const patch of [
    { normalizedUrl: "https://attacker.invalid/nfc/Abcdefghijklmnopqrstuvwxyz012345" },
    { normalizedUrl: `${base.normalizedUrl}?next=https://attacker.invalid` },
    { chipType: "NTAG424_DNA" },
    { uidFingerprintSha256: "raw-uid-04AABBCC" },
  ]) {
    const runtime = deps();
    const output = response();
    await createAiGraderNfcApiHandler(runtime.value)(
      request({ action: "complete", body: { ...base, ...patch } }),
      output.res,
    );
    assert.equal(output.read().statusCode, 400);
    assert.equal(runtime.calls.length, 0);
  }
});

test("NFC complete forwards fixed local PCSC human-readback evidence only", async () => {
  const runtime = deps();
  const output = response();
  const publicTagId = "Abcdefghijklmnopqrstuvwxyz012345";
  await createAiGraderNfcApiHandler(runtime.value)(
    request({
      action: "complete",
      body: {
        reportId: "report-1",
        cardAssetId: "card-1",
        itemId: "item-1",
        certId: "TK-AIG-1",
        publicTagId,
        attemptId: "AttemptAbcdefghijklmnop",
        attemptToken: "TokenTokenTokenTokenTokenTokenTokenToken",
        idempotencyKey: "complete-report-1",
        chipType: "NTAG215",
        normalizedUrl: `https://collect.tenkings.co/nfc/${publicTagId}`,
        uidFingerprintSha256: "a".repeat(64),
        readbackPayloadSha256: "b".repeat(64),
        readerResultCode: "write_verified_pcsc_readback",
        helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v1",
        rawUid: "04AABBCC",
        localPath: "C:\\secret",
      },
    }),
    output.res,
  );
  assert.equal(output.read().statusCode, 200);
  assert.equal(runtime.calls[0].input.evidenceType, "local_pcsc_readback_human_operator");
  assert.equal("rawUid" in runtime.calls[0].input, false);
  assert.equal("localPath" in runtime.calls[0].input, false);
});

test("NFC mutations require bounded reasons and reject oversized JSON before runtime calls", async () => {
  const runtime = deps();
  const short = response();
  await createAiGraderNfcApiHandler(runtime.value)(
    request({ action: "revoke", body: { reportId: "report-1", reason: "no", idempotencyKey: "revoke-report-1" } }),
    short.res,
  );
  assert.equal(short.read().statusCode, 400);

  const large = response();
  await createAiGraderNfcApiHandler(runtime.value)(
    request({ action: "init", body: { reportId: "report-1", idempotencyKey: "program-report-1", padding: "x".repeat(40_000) } }),
    large.res,
  );
  assert.equal(large.read().statusCode, 413);
  assert.equal(runtime.calls.length, 0);
});

test("NFC replacement is pinned to the operator-visible public tag identity for idempotent retry", async () => {
  const runtime = deps();
  const output = response();
  await createAiGraderNfcApiHandler(runtime.value)(
    request({
      action: "replace",
      body: {
        reportId: "report-1",
        replacedPublicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
        reason: "Replace damaged NFC in slab",
        idempotencyKey: "replace-report-1",
      },
    }),
    output.res,
  );
  assert.equal(output.read().statusCode, 200);
  assert.equal(runtime.calls[0].input.replacedPublicTagId, "Abcdefghijklmnopqrstuvwxyz012345");
});

test("NFC service accounts fail closed because programming requires a human operator", async () => {
  const runtime = deps({
    env: {
      AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings",
      AI_GRADER_SERVICE_ACCOUNT_ID: "service-1",
      AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256: "0".repeat(64),
      AI_GRADER_SERVICE_ACCOUNT_SCOPES: "nfc-program",
    },
  });
  const output = response();
  await createAiGraderNfcApiHandler(runtime.value)(
    request({ method: "GET", action: "status", query: { reportId: "report-1" } }),
    output.res,
  );
  assert.equal(output.read().statusCode, 403);
  assert.equal(runtime.calls.length, 0);
});
