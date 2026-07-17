import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_NFC_HELPER_BASE_URL,
  AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
  AI_GRADER_NFC_INIT_IDEMPOTENCY_STORAGE_PREFIX,
  AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY,
  AI_GRADER_NFC_PROFILE_STORAGE_KEY,
  acknowledgeAiGraderF8215Operation,
  AiGraderNfcHelperError,
  classifyAiGraderNfcHelperWriteRecovery,
  clearAiGraderNfcHelperPairing,
  clearAiGraderNfcInitIdempotencyKey,
  getOrCreateAiGraderNfcInitIdempotencyKey,
  getAiGraderNfcHelperStatus,
  getAiGraderF8215OperationStatus,
  pairAiGraderNfcHelper,
  prepareAiGraderF8215Job,
  readAiGraderNfcSelectedProfile,
  readAiGraderNfcInitIdempotencyKey,
  waitForAiGraderNfcHelperIdle,
  writeAiGraderNfcTag,
  writeAiGraderNfcSelectedProfile,
} from "../lib/aiGraderNfcHelperClient";

function installWindow() {
  const values = new Map<string, string>();
  const sessionValues = new Map<string, string>();
  const storage = (map: Map<string, string>) => ({
    getItem(key: string) { return map.get(key) ?? null; },
    setItem(key: string, value: string) { map.set(key, value); },
    removeItem(key: string) { map.delete(key); },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage(values),
      sessionStorage: storage(sessionValues),
    },
  });
  return { values, sessionValues };
}

test("NFC helper pairing uses its distinct loopback token and exact fixed base URL", async () => {
  const { values } = installWindow();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const result = url.endsWith("/pair")
        ? { workstationToken: "NfcTokenNfcTokenNfcTokenNfcToken1234" }
        : { helperProtocolVersion: "1.0", readerConnected: true, pcscReady: true, tagState: "present", busy: false };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await pairAiGraderNfcHelper("PairCode123");
  assert.equal(calls[0].url, `${AI_GRADER_NFC_HELPER_BASE_URL}/pair`);
  assert.equal(calls[1].url, `${AI_GRADER_NFC_HELPER_BASE_URL}/status`);
  assert.equal(values.has(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY), true);
  assert.equal(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY, "tenkings.aiGrader.nfc.workstationToken.v1");
  assert.equal((calls[1].init.headers as Record<string, string>)["x-tenkings-nfc-token"], "NfcTokenNfcTokenNfcTokenNfcToken1234");
});

test("NFC helper refuses status without a paired local token", async () => {
  installWindow();
  clearAiGraderNfcHelperPairing();
  await assert.rejects(getAiGraderNfcHelperStatus(), (error: unknown) => {
    return error instanceof Error && error.message.includes("Pair this NFC workstation");
  });
});

test("NFC helper write sends only the fixed operation contract and explicit overwrite challenge", async () => {
  const { values } = installWindow();
  values.set(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY, "NfcTokenNfcTokenNfcTokenNfcToken1234");
  let captured: Record<string, unknown> | null = null;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init: RequestInit) => {
      assert.equal(url, `${AI_GRADER_NFC_HELPER_BASE_URL}/write`);
      captured = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, result: { normalizedUrl: captured?.url } }), { status: 200 });
    },
  });
  await writeAiGraderNfcTag({
    attemptId: "AttemptAbcdefghijklmnop",
    idempotencyKey: "write-AttemptAbcdefghijklmnop",
    publicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
    attestationChallenge: "A".repeat(43),
    url: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
    overwriteConfirmation: { confirmed: true, observedPayloadSha256: "a".repeat(64) },
  });
  assert.deepEqual(Object.keys(captured ?? {}).sort(), [
    "attemptId",
    "attestationChallenge",
    "idempotencyKey",
    "overwriteConfirmation",
    "publicTagId",
    "url",
  ]);
  assert.equal("apdu" in (captured ?? {}), false);
  assert.equal("rawUid" in (captured ?? {}), false);
});

test("F8215 helper client uses bounded prepare/status/ack contracts without URL or UID storage", async () => {
  const { values } = installWindow();
  values.set(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY, "NfcTokenNfcTokenNfcTokenNfcToken1234");
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      const result = url.endsWith("/prepare")
        ? {
            helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
            attemptId: body.attemptId,
            chipType: "FEIJU_F8215",
            programmingProfile: "gototags_manual_start_v1",
            phase: "awaiting_manual_start",
          }
        : url.endsWith("/operation-status")
          ? {
              helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
              attemptId: body.attemptId,
              chipType: "FEIJU_F8215",
              programmingProfile: "gototags_manual_start_v1",
              phase: "awaiting_manual_start",
              terminal: false,
              retryable: false,
            }
          : { helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION, attemptId: body.attemptId, cleaned: true };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    },
  });
  const attemptId = "nfc_attempt_" + "A".repeat(43);
  await prepareAiGraderF8215Job({
    attemptId,
    idempotencyKey: `prepare-${attemptId}`,
    publicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
    attestationChallenge: "A".repeat(43),
    url: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
    attemptExpiresAt: "2026-07-16T23:50:00.000Z",
  });
  await getAiGraderF8215OperationStatus(attemptId);
  await acknowledgeAiGraderF8215Operation(attemptId);
  assert.deepEqual(calls.map((call) => call.url), [
    `${AI_GRADER_NFC_HELPER_BASE_URL}/prepare`,
    `${AI_GRADER_NFC_HELPER_BASE_URL}/operation-status`,
    `${AI_GRADER_NFC_HELPER_BASE_URL}/operation-ack`,
  ]);
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    "attemptExpiresAt",
    "attemptId",
    "attestationChallenge",
    "chipType",
    "idempotencyKey",
    "programmingProfile",
    "publicTagId",
    "url",
  ]);
  assert.equal(calls[0].body.chipType, "FEIJU_F8215");
  assert.equal(calls[0].body.programmingProfile, "gototags_manual_start_v1");
  assert.equal("uid" in calls[0].body, false);
  assert.equal("rawUid" in calls[0].body, false);
});

test("selected NFC profile remembers only the profile identity locally", () => {
  const { values } = installWindow();
  assert.equal(readAiGraderNfcSelectedProfile(), "NTAG215_DIRECT_PCSC");
  writeAiGraderNfcSelectedProfile("FEIJU_F8215_GOTOTAGS_MANUAL_START");
  assert.equal(readAiGraderNfcSelectedProfile(), "FEIJU_F8215_GOTOTAGS_MANUAL_START");
  assert.deepEqual([...values.keys()].sort(), [AI_GRADER_NFC_PROFILE_STORAGE_KEY]);
  assert.equal(values.get(AI_GRADER_NFC_PROFILE_STORAGE_KEY), "FEIJU_F8215_GOTOTAGS_MANUAL_START");
});

test("NFC retry storage persists only one report-scoped init idempotency key", () => {
  const { sessionValues } = installWindow();
  const storage = window.sessionStorage;
  const first = getOrCreateAiGraderNfcInitIdempotencyKey("report-1", storage, () => "11111111-2222-4333-8444-555555555555");
  const second = getOrCreateAiGraderNfcInitIdempotencyKey("report-1", storage, () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(first, second);
  assert.equal(readAiGraderNfcInitIdempotencyKey("report-1", storage), first);
  assert.deepEqual([...sessionValues.keys()], [`${AI_GRADER_NFC_INIT_IDEMPOTENCY_STORAGE_PREFIX}report-1`]);
  const persisted = JSON.stringify([...sessionValues.entries()]);
  for (const forbidden of ["attemptToken", "attestationChallenge", "signature", "uidFingerprint", "helperToken"]) {
    assert.equal(persisted.includes(forbidden), false);
  }
  clearAiGraderNfcInitIdempotencyKey("report-1", storage);
  assert.equal(sessionValues.size, 0);
});

test("NFC helper recovery distinguishes definite pre-write faults and waits boundedly for uncertain completion", async () => {
  assert.equal(
    classifyAiGraderNfcHelperWriteRecovery(new AiGraderNfcHelperError("no_tag", "Place a tag", 409, undefined, true)),
    "definite_prewrite",
  );
  assert.equal(
    classifyAiGraderNfcHelperWriteRecovery(
      new AiGraderNfcHelperError("reader_disconnected", "A write may have started", 409, undefined, true),
    ),
    "uncertain",
  );
  assert.equal(
    classifyAiGraderNfcHelperWriteRecovery(new AiGraderNfcHelperError("reader_timeout", "Wait", 504, undefined, true)),
    "uncertain",
  );
  assert.equal(
    classifyAiGraderNfcHelperWriteRecovery(
      new AiGraderNfcHelperError("overwrite_confirmation_mismatch", "Observed content changed", 409, undefined, true),
    ),
    "definite_prewrite",
  );
  let reads = 0;
  const status = await waitForAiGraderNfcHelperIdle({
    attempts: 3,
    delayMs: 25,
    delay: async () => undefined,
    readStatus: async () => ({
      helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
      readerConnected: true,
      pcscReady: true,
      tagState: "present",
      busy: ++reads < 3,
    }),
  });
  assert.equal(reads, 3);
  assert.equal(status.busy, false);
  await assert.rejects(
    waitForAiGraderNfcHelperIdle({
      attempts: 1,
      readStatus: async () => ({
        helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
        readerConnected: true,
        pcscReady: true,
        tagState: "present",
        busy: true,
      }),
    }),
    (error: unknown) => error instanceof Error && error.message.includes("Keep the same physical tag"),
  );
});
