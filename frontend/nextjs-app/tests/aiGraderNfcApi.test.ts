import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    schemaReadiness: async () => true,
    readiness: () => ({
      nfcSchemaReady: true,
      nfcProgrammingEnabled: true,
      nfcRequired: false,
      nfcAttemptTokenConfigured: true,
      nfcWorkstationAttestationConfigured: true,
      nfcWorkstationKeyCount: 1,
      expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
    }),
    requireUserSession: async () => ({
      id: "session-1",
      tokenHash: "redacted-session-hash",
      user: { id: "operator-1", phone: null, displayName: "Operator", avatarUrl: null },
    }),
    init: operation("init") as AiGraderNfcApiDependencies["init"],
    complete: operation("complete") as AiGraderNfcApiDependencies["complete"],
    publishedLinkage: async ({ reportId }) => ({
      reportId,
      cardAssetId: "card-1",
      itemId: "item-1",
      certId: "cert-1",
      cardTitle: "Published Card",
    }),
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
  assert.deepEqual(result.payload, {
    ok: true,
    operation: "aiGraderNfcStatus",
    result: {
      status: "missing",
      nfcSchemaReady: true,
      nfcProgrammingEnabled: true,
      nfcRequired: false,
      nfcAttemptTokenConfigured: true,
      nfcWorkstationAttestationConfigured: true,
      nfcWorkstationKeyCount: 1,
      expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
      canProgram: true,
      canAdmin: false,
    },
  });
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

test("F8215 init uses the global programming gate and forwards only the exact reviewed profile", async () => {
  const enabled = deps();
  const enabledOutput = response();
  await createAiGraderNfcApiHandler(enabled.value)(request({
    action: "init",
    body: {
      reportId: "report-1",
      idempotencyKey: "program-feiju-report-1",
      chipType: "FEIJU_F8215",
      programmingProfile: "gototags_manual_start_v1",
    },
  }), enabledOutput.res);
  assert.equal(enabledOutput.read().statusCode, 400);
  assert.equal((enabledOutput.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_FRESH_INVENTORY_CONFIRMATION_REQUIRED");
  assert.equal(enabled.calls.length, 0);

  const confirmedOutput = response();
  await createAiGraderNfcApiHandler(enabled.value)(request({
    action: "init",
    body: {
      reportId: "report-1",
      idempotencyKey: "program-feiju-report-1",
      chipType: "FEIJU_F8215",
      programmingProfile: "gototags_manual_start_v1",
      operatorFreshInventoryConfirmation: "operator_fresh_inventory_confirmation_v1",
      url: "https://attacker.invalid/",
    },
  }), confirmedOutput.res);
  assert.equal(confirmedOutput.read().statusCode, 200);
  assert.equal(enabled.calls[0].input.chipType, "FEIJU_F8215");
  assert.equal(enabled.calls[0].input.programmingProfile, "gototags_manual_start_v1");
  assert.equal(enabled.calls[0].input.operatorFreshInventoryConfirmation, "operator_fresh_inventory_confirmation_v1");
  assert.equal("url" in enabled.calls[0].input, false);
});

test("F8215 complete requires exact v2 adapter, URL, verification, and permanent-lock evidence", async () => {
  const base = {
    reportId: "report-1",
    cardAssetId: "card-1",
    itemId: "item-1",
    certId: "TK-AIG-1",
    publicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
    attemptId: "AttemptAbcdefghijklmnop",
    attemptToken: "TokenTokenTokenTokenTokenTokenTokenToken",
    idempotencyKey: "complete-feiju-report-1",
    chipType: "FEIJU_F8215",
    programmingProfile: "gototags_manual_start_v1",
    normalizedUrl: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
    uidFingerprintSha256: "a".repeat(64),
    readbackPayloadSha256: "b".repeat(64),
    readerResultCode: "write_locked_verified_gototags_readback",
    helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
    adapterIdentity: "gototags_desktop",
    adapterVersion: "4.37.0.1",
    writeProtectionState: "permanently_read_only_verified",
    operationalAttestation: {
      schemaVersion: "ai-grader-nfc-helper-attestation-v2",
      workstationKeyId: "c".repeat(64),
      algorithm: "ecdsa-p256-sha256-p1363",
      attestationChallenge: "A".repeat(43),
      observedAt: "2026-07-16T22:36:52.279Z",
      signature: "S".repeat(86),
    },
  };
  const ready = () => ({
    nfcSchemaReady: true,
    nfcProgrammingEnabled: true,
    nfcRequired: false,
    nfcAttemptTokenConfigured: true,
    nfcWorkstationAttestationConfigured: true,
    nfcWorkstationKeyCount: 1,
    expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
  });
  const accepted = deps({ readiness: ready });
  const acceptedOutput = response();
  await createAiGraderNfcApiHandler(accepted.value)(request({ action: "complete", body: base }), acceptedOutput.res);
  assert.equal(acceptedOutput.read().statusCode, 200);
  assert.equal(accepted.calls[0].input.adapterIdentity, "gototags_desktop");
  assert.equal(accepted.calls[0].input.writeProtectionState, "permanently_read_only_verified");

  for (const patch of [
    { operationalAttestation: { ...base.operationalAttestation, schemaVersion: "ai-grader-nfc-helper-attestation-v1" } },
    { adapterVersion: "4.38.0.0" },
    { writeProtectionState: "unknown" },
    { readerResultCode: "write_verified_pcsc_readback" },
    { programmingProfile: "ntag215_direct_pcsc_v1" },
    { normalizedUrl: `${base.normalizedUrl}?wrong=1` },
  ]) {
    const rejected = deps({ readiness: ready });
    const rejectedOutput = response();
    await createAiGraderNfcApiHandler(rejected.value)(
      request({ action: "complete", body: { ...base, ...patch } }),
      rejectedOutput.res,
    );
    assert.equal(rejectedOutput.read().statusCode, 400);
    assert.equal(rejected.calls.length, 0);
  }
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
    helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
    operationalAttestation: {
      schemaVersion: "ai-grader-nfc-helper-attestation-v1",
      workstationKeyId: "c".repeat(64),
      algorithm: "ecdsa-p256-sha256-p1363",
      attestationChallenge: "A".repeat(43),
      observedAt: "2026-07-13T12:00:00.000Z",
      signature: "S".repeat(86),
    },
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
        helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
        operationalAttestation: {
          schemaVersion: "ai-grader-nfc-helper-attestation-v1",
          workstationKeyId: "c".repeat(64),
          algorithm: "ecdsa-p256-sha256-p1363",
          attestationChallenge: "A".repeat(43),
          observedAt: "2026-07-13T12:00:00.000Z",
          signature: "S".repeat(86),
        },
        rawUid: "04AABBCC",
        localPath: "C:\\secret",
      },
    }),
    output.res,
  );
  assert.equal(output.read().statusCode, 200);
  assert.equal((runtime.calls[0].input.operationalAttestation as Record<string, unknown>).algorithm, "ecdsa-p256-sha256-p1363");
  assert.equal("rawUid" in runtime.calls[0].input, false);
  assert.equal("localPath" in runtime.calls[0].input, false);
});

test("NFC complete requires the strict signed helper result contract before runtime activation", async () => {
  const publicTagId = "Abcdefghijklmnopqrstuvwxyz012345";
  const base = {
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
    helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
    operationalAttestation: {
      schemaVersion: "ai-grader-nfc-helper-attestation-v1",
      workstationKeyId: "c".repeat(64),
      algorithm: "ecdsa-p256-sha256-p1363",
      attestationChallenge: "A".repeat(43),
      observedAt: "2026-07-13T12:00:00.000Z",
      signature: "S".repeat(86),
    },
  };
  for (const patch of [
    { operationalAttestation: undefined },
    { operationalAttestation: { ...base.operationalAttestation, algorithm: "caller-asserted" } },
    { operationalAttestation: { ...base.operationalAttestation, signature: "short" } },
    { readerResultCode: "overwrite_confirmation_required" },
  ]) {
    const runtime = deps();
    const output = response();
    await createAiGraderNfcApiHandler(runtime.value)(request({ action: "complete", body: { ...base, ...patch } }), output.res);
    assert.equal(output.read().statusCode, 400);
    assert.equal(runtime.calls.length, 0);
  }
  const runtime = deps();
  const output = response();
  await createAiGraderNfcApiHandler(runtime.value)(request({
    action: "complete",
    body: { ...base, helperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v1" },
  }), output.res);
  assert.equal(output.read().statusCode, 409);
  assert.equal(runtime.calls.length, 0);
});

test("NFC mutations require bounded reasons and reject oversized JSON before runtime calls", async () => {
  const runtime = deps({
    env: { AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings", AI_GRADER_ADMIN_USER_IDS: "admin-1" },
    requireUserSession: async () => ({
      id: "session-admin",
      tokenHash: "redacted-session-hash",
      user: { id: "admin-1", phone: null, displayName: "Admin", avatarUrl: null },
    }),
  });
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
  const runtime = deps({
    env: {
      AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings",
      AI_GRADER_ADMIN_USER_IDS: "admin-1",
    },
    requireUserSession: async () => ({
      id: "session-admin",
      tokenHash: "redacted-session-hash",
      user: { id: "admin-1", phone: null, displayName: "Admin", avatarUrl: null },
    }),
  });
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

test("NFC authorization is server-enforced for operators, admins, and client role spoofing", async () => {
  for (const action of ["revoke", "replace"] as const) {
    const runtime = deps();
    const output = response();
    await createAiGraderNfcApiHandler(runtime.value)(request({
      action,
      body: action === "revoke"
        ? { reportId: "report-1", reason: "Operator cannot revoke", idempotencyKey: "revoke-report-1", role: "ai_grader_admin" }
        : {
            reportId: "report-1",
            replacedPublicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
            reason: "Operator cannot replace",
            idempotencyKey: "replace-report-1",
            role: "ai_grader_admin",
          },
    }), output.res);
    assert.equal(output.read().statusCode, 403);
    assert.equal((output.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_ADMIN_REQUIRED");
    assert.equal(runtime.calls.length, 0);
  }

  const admin = deps({
    env: { AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings", AI_GRADER_ADMIN_USER_IDS: "admin-1" },
    requireUserSession: async () => ({
      id: "session-admin",
      tokenHash: "redacted-session-hash",
      user: { id: "admin-1", phone: null, displayName: "Admin", avatarUrl: null },
    }),
  });
  const statusOutput = response();
  await createAiGraderNfcApiHandler(admin.value)(
    request({ method: "GET", action: "status", query: { reportId: "report-1" } }),
    statusOutput.res,
  );
  assert.equal(((statusOutput.read().payload as { result: Record<string, unknown> }).result).canAdmin, true);
  const initOutput = response();
  await createAiGraderNfcApiHandler(admin.value)(request({
    action: "init",
    body: { reportId: "report-1", idempotencyKey: "admin-program-report-1" },
  }), initOutput.res);
  assert.equal(initOutput.read().statusCode, 200);
  assert.equal(admin.calls.some((call) => call.operation === "init"), true);
});

test("NFC service accounts fail closed for programming and administration even with configured scopes", async () => {
  const serviceToken = "ServiceNfcTokenServiceNfcToken123456";
  const runtime = deps({
    env: {
      AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings",
      AI_GRADER_SERVICE_ACCOUNT_ID: "service-1",
      AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256: createHash("sha256").update(serviceToken).digest("hex"),
      AI_GRADER_SERVICE_ACCOUNT_SCOPES: "nfc-program,nfc-admin",
    },
  });
  for (const input of [
    { method: "GET", action: "status", query: { reportId: "report-1" } },
    { action: "init", body: { reportId: "report-1", idempotencyKey: "program-report-1" } },
    { action: "revoke", body: { reportId: "report-1", reason: "Service cannot revoke", idempotencyKey: "revoke-report-1" } },
  ]) {
    const output = response();
    await createAiGraderNfcApiHandler(runtime.value)(request({ ...input, headers: { "x-ai-grader-service-token": serviceToken } }), output.res);
    assert.equal(output.read().statusCode, 403);
    assert.equal((output.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_HUMAN_REQUIRED");
  }
  assert.equal(runtime.calls.length, 0);
});

test("NFC programming flag is independent, status/revoke stay available, and readiness is redacted", async () => {
  const disabled = deps({
    readiness: () => ({
      nfcSchemaReady: true,
      nfcProgrammingEnabled: false,
      nfcRequired: true,
      nfcAttemptTokenConfigured: false,
      nfcWorkstationAttestationConfigured: false,
      nfcWorkstationKeyCount: 0,
      expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
    }),
  });
  const initOutput = response();
  await createAiGraderNfcApiHandler(disabled.value)(request({
    action: "init",
    body: { reportId: "report-1", idempotencyKey: "program-report-1" },
  }), initOutput.res);
  assert.equal(initOutput.read().statusCode, 503);
  assert.equal((initOutput.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_PROGRAMMING_DISABLED");

  const statusOutput = response();
  await createAiGraderNfcApiHandler(disabled.value)(
    request({ method: "GET", action: "status", query: { reportId: "report-1" } }),
    statusOutput.res,
  );
  assert.equal(statusOutput.read().statusCode, 200);
  const json = JSON.stringify(statusOutput.read().payload);
  for (const forbidden of ["publicSpki", "signature", "attestationChallenge", "workstationKeyId", "attemptToken", "helperToken", "pairingCode"]) {
    assert.equal(json.includes(forbidden), false);
  }

  const disabledAdmin = deps({
    env: { AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings", AI_GRADER_ADMIN_USER_IDS: "admin-1" },
    requireUserSession: async () => ({
      id: "session-admin",
      tokenHash: "redacted-session-hash",
      user: { id: "admin-1", phone: null, displayName: "Admin", avatarUrl: null },
    }),
    readiness: disabled.value.readiness,
  });
  const revokeOutput = response();
  await createAiGraderNfcApiHandler(disabledAdmin.value)(request({
    action: "revoke",
    body: { reportId: "report-1", reason: "Admin revokes while disabled", idempotencyKey: "revoke-report-1" },
  }), revokeOutput.res);
  assert.equal(revokeOutput.read().statusCode, 200);
  assert.equal(disabledAdmin.calls[0].operation, "revoke");

  const misconfigured = deps({
    readiness: () => ({
      nfcSchemaReady: true,
      nfcProgrammingEnabled: true,
      nfcRequired: false,
      nfcAttemptTokenConfigured: false,
      nfcWorkstationAttestationConfigured: false,
      nfcWorkstationKeyCount: 0,
      expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
    }),
  });
  const missingOutput = response();
  await createAiGraderNfcApiHandler(misconfigured.value)(request({
    action: "init",
    body: { reportId: "report-1", idempotencyKey: "program-report-1" },
  }), missingOutput.res);
  assert.equal(missingOutput.read().statusCode, 503);
  assert.equal((missingOutput.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_PROGRAMMING_NOT_CONFIGURED");
});

test("NFC schema absence is redacted, status remains available, and every mutation fails with the stable gate", async () => {
  const runtime = deps({ schemaReadiness: async () => false });
  const statusOutput = response();
  await createAiGraderNfcApiHandler(runtime.value)(
    request({ method: "GET", action: "status", query: { reportId: "report-1" } }),
    statusOutput.res,
  );
  assert.equal(statusOutput.read().statusCode, 200);
  assert.deepEqual((statusOutput.read().payload as { result: Record<string, unknown> }).result, {
    status: "unavailable",
    reportId: "report-1",
    cardAssetId: "card-1",
    itemId: "item-1",
    certId: "cert-1",
    cardTitle: "Published Card",
    registrationKind: "not_active",
    cryptographicallyVerified: false,
    nfcSchemaReady: false,
    nfcProgrammingEnabled: true,
    nfcRequired: false,
    nfcAttemptTokenConfigured: true,
    nfcWorkstationAttestationConfigured: true,
    nfcWorkstationKeyCount: 1,
    expectedNfcHelperProtocolVersion: "tenkings-ai-grader-nfc-loopback-v2",
    canProgram: true,
    canAdmin: false,
  });
  assert.equal(runtime.calls.length, 0);

  const initOutput = response();
  await createAiGraderNfcApiHandler(runtime.value)(request({
    action: "init",
    body: { reportId: "report-1", idempotencyKey: "program-report-1" },
  }), initOutput.res);
  assert.equal(initOutput.read().statusCode, 503);
  assert.equal((initOutput.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_SCHEMA_UNAVAILABLE");
  assert.equal(runtime.calls.length, 0);

  const admin = deps({
    schemaReadiness: async () => false,
    env: { AI_GRADER_PRODUCTION_TENANT_ID: "ten-kings", AI_GRADER_ADMIN_USER_IDS: "admin-1" },
    requireUserSession: async () => ({
      id: "session-admin",
      tokenHash: "redacted-session-hash",
      user: { id: "admin-1", phone: null, displayName: "Admin", avatarUrl: null },
    }),
  });
  const revokeOutput = response();
  await createAiGraderNfcApiHandler(admin.value)(request({
    action: "revoke",
    body: { reportId: "report-1", reason: "Schema unavailable test", idempotencyKey: "revoke-report-1" },
  }), revokeOutput.res);
  assert.equal(revokeOutput.read().statusCode, 503);
  assert.equal((revokeOutput.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_SCHEMA_UNAVAILABLE");
  assert.equal(admin.calls.length, 0);
});

test("schema-absent status still requires durable published linkage", async () => {
  for (const code of [
    "AI_GRADER_NFC_REPORT_NOT_FOUND",
    "AI_GRADER_NFC_REPORT_NOT_PUBLISHED",
    "AI_GRADER_NFC_CONFIRM_AUTHORITY_MISMATCH",
  ]) {
    const runtime = deps({
      schemaReadiness: async () => false,
      publishedLinkage: async () => {
        throw Object.assign(new Error("NFC published linkage was rejected."), { statusCode: 409, code });
      },
    });
    const output = response();
    await createAiGraderNfcApiHandler(runtime.value)(
      request({ method: "GET", action: "status", query: { reportId: "report-1" } }),
      output.res,
    );
    assert.equal(output.read().statusCode, 409);
    assert.equal((output.read().payload as Record<string, unknown>).code, code);
    assert.equal(runtime.calls.length, 0);
  }
});

test("unexpected NFC schema-check failures are never mislabeled as an unapplied migration", async () => {
  const runtime = deps({
    schemaReadiness: async () => {
      throw Object.assign(new Error("database connection sentinel"), { code: "P1001" });
    },
  });
  const output = response();
  await createAiGraderNfcApiHandler(runtime.value)(request({
    action: "init",
    body: { reportId: "report-1", idempotencyKey: "program-report-1" },
  }), output.res);
  assert.equal(output.read().statusCode, 503);
  assert.equal((output.read().payload as Record<string, unknown>).code, "AI_GRADER_NFC_SCHEMA_CHECK_FAILED");
  assert.equal(JSON.stringify(output.read().payload).includes("connection sentinel"), false);
  assert.equal(runtime.calls.length, 0);
});
