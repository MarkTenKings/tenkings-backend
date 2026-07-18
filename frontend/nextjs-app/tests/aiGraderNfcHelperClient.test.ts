import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_NFC_HELPER_BASE_URL,
  AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
  AI_GRADER_NFC_INIT_IDEMPOTENCY_STORAGE_PREFIX,
  AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY,
  AI_GRADER_NFC_PROFILE_STORAGE_KEY,
  acknowledgeAiGraderF8215Operation,
  aiGraderNfcHelperHostedReady,
  AiGraderNfcHelperError,
  clearAiGraderNfcHelperPairing,
  clearAiGraderNfcInitIdempotencyKey,
  consumeAiGraderNfcLauncherFragment,
  connectAiGraderNfcHelper,
  getOrCreateAiGraderNfcInitIdempotencyKey,
  getAiGraderNfcHelperStatus,
  getAiGraderF8215OperationStatus,
  pairAiGraderNfcHelper,
  prepareAiGraderF8215Job,
  reconcileAiGraderF8215HostedActivation,
  readAiGraderNfcSelectedProfile,
  readAiGraderNfcInitIdempotencyKey,
  writeAiGraderNfcTag,
  writeAiGraderNfcSelectedProfile,
} from "../lib/aiGraderNfcHelperClient";

const readyHostedNfc = {
  nfcSchemaReady: true,
  nfcProgrammingEnabled: true,
  nfcAttemptTokenConfigured: true,
  nfcWorkstationAttestationConfigured: true,
  nfcWorkstationKeyCount: 1,
  expectedNfcHelperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
};

const readyHelperStatus = {
  helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
  readerConnected: true,
  pcscReady: true,
  tagState: "absent" as const,
  busy: false,
};

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

test("launcher fragment is consumed in memory and scrubbed without rendering or persisting its code", () => {
  let replacement = "";
  const consumed = consumeAiGraderNfcLauncherFragment({
    hash: "#aiGraderNfcLaunch=v1&aiGraderNfcPair=FreshPairCode123",
    pathname: "/ai-grader/nfc",
    search: "?reportId=report-1",
    replaceUrl: (url) => { replacement = url; },
  });
  assert.deepEqual(consumed, { launchedFromShortcut: true, pairingCode: "FreshPairCode123" });
  assert.equal(replacement, "/ai-grader/nfc?reportId=report-1");

  replacement = "";
  assert.deepEqual(
    consumeAiGraderNfcLauncherFragment({
      hash: "#aiGraderNfcLaunch=v1&aiGraderNfcPair=not%20valid",
      pathname: "/ai-grader/nfc",
      search: "",
      replaceUrl: (url) => { replacement = url; },
    }),
    { launchedFromShortcut: true, pairingCode: "" },
  );
  assert.equal(replacement, "/ai-grader/nfc");

  replacement = "";
  assert.deepEqual(
    consumeAiGraderNfcLauncherFragment({
      hash: "#unrelated=value",
      pathname: "/ai-grader/nfc",
      search: "",
      replaceUrl: (url) => { replacement = url; },
    }),
    { launchedFromShortcut: false, pairingCode: "" },
  );
  assert.equal(replacement, "");
});

test("hosted readiness is strict and disabled bootstrap makes no local dependency call", async () => {
  assert.equal(aiGraderNfcHelperHostedReady(readyHostedNfc), true);
  assert.equal(aiGraderNfcHelperHostedReady({ ...readyHostedNfc, nfcSchemaReady: false }), false);
  assert.equal(aiGraderNfcHelperHostedReady({ ...readyHostedNfc, nfcProgrammingEnabled: false }), false);
  assert.equal(aiGraderNfcHelperHostedReady({ ...readyHostedNfc, nfcAttemptTokenConfigured: false }), false);
  assert.equal(aiGraderNfcHelperHostedReady({ ...readyHostedNfc, nfcWorkstationAttestationConfigured: false }), false);
  assert.equal(aiGraderNfcHelperHostedReady({ ...readyHostedNfc, nfcWorkstationKeyCount: 0 }), false);
  assert.equal(aiGraderNfcHelperHostedReady({ ...readyHostedNfc, expectedNfcHelperProtocolVersion: "unexpected" }), false);

  let dependencyCalls = 0;
  const result = await connectAiGraderNfcHelper(
    { readiness: { ...readyHostedNfc, nfcProgrammingEnabled: false }, pairingCode: "PairCode123" },
    {
      hasPairing: () => { dependencyCalls += 1; return false; },
      status: async () => { dependencyCalls += 1; return readyHelperStatus; },
      pair: async () => { dependencyCalls += 1; return readyHelperStatus; },
    },
  );
  assert.deepEqual(result, { state: "disabled" });
  assert.equal(dependencyCalls, 0);
});

test("ready bootstrap requires the workstation shortcut when no saved token or code exists", async () => {
  let statusCalls = 0;
  let pairCalls = 0;
  const result = await connectAiGraderNfcHelper(
    { readiness: readyHostedNfc },
    {
      hasPairing: () => false,
      status: async () => { statusCalls += 1; return readyHelperStatus; },
      pair: async () => { pairCalls += 1; return readyHelperStatus; },
    },
  );
  assert.deepEqual(result, { state: "shortcut_required" });
  assert.equal(statusCalls, 0);
  assert.equal(pairCalls, 0);
});

test("ready bootstrap validates a saved token through status without pairing again", async () => {
  let statusCalls = 0;
  let pairCalls = 0;
  const result = await connectAiGraderNfcHelper(
    { readiness: readyHostedNfc, pairingCode: "PairCode123" },
    {
      hasPairing: () => true,
      status: async () => { statusCalls += 1; return readyHelperStatus; },
      pair: async () => { pairCalls += 1; return readyHelperStatus; },
    },
  );
  assert.deepEqual(result, { state: "connected", status: readyHelperStatus, pairedNow: false });
  assert.equal(statusCalls, 1);
  assert.equal(pairCalls, 0);
});

test("ready bootstrap repairs an invalid saved token only with a valid fresh shortcut code", async () => {
  let clearCalls = 0;
  let pairedWith = "";
  const result = await connectAiGraderNfcHelper(
    { readiness: readyHostedNfc, pairingCode: "FreshPairCode123" },
    {
      hasPairing: () => true,
      clearPairing: () => { clearCalls += 1; },
      status: async () => {
        throw new AiGraderNfcHelperError(
          "workstation_token_invalid",
          "Pair this NFC workstation before programming.",
          401,
        );
      },
      pair: async (pairingCode) => { pairedWith = pairingCode; return readyHelperStatus; },
    },
  );
  assert.deepEqual(result, { state: "connected", status: readyHelperStatus, pairedNow: true });
  assert.equal(clearCalls, 1);
  assert.equal(pairedWith, "FreshPairCode123");
});

test("default bootstrap replaces an invalid saved token without sending it to the pairing route", async () => {
  const { values } = installWindow();
  const oldToken = "OldTokenOldTokenOldTokenOldToken1234";
  const newToken = "NewTokenNewTokenNewTokenNewToken1234";
  values.set(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY, oldToken);
  const calls: Array<{ url: string; token: string; body: string }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        token: headers.get("x-tenkings-nfc-token") ?? "",
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          ok: false,
          error: { code: "workstation_token_invalid", message: "Pair this NFC workstation before programming." },
        }), { status: 401, headers: { "content-type": "application/json" } });
      }
      if (calls.length === 2) {
        return new Response(JSON.stringify({ ok: true, result: { workstationToken: newToken } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, result: readyHelperStatus }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await connectAiGraderNfcHelper({ readiness: readyHostedNfc, pairingCode: "FreshPairCode123" });
  assert.deepEqual(result, { state: "connected", status: readyHelperStatus, pairedNow: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, `${AI_GRADER_NFC_HELPER_BASE_URL}/status`);
  assert.equal(calls[0].token, oldToken);
  assert.equal(calls[1].url, `${AI_GRADER_NFC_HELPER_BASE_URL}/pair`);
  assert.equal(calls[1].token, "");
  assert.deepEqual(JSON.parse(calls[1].body), { pairingCode: "FreshPairCode123" });
  assert.equal(calls[2].url, `${AI_GRADER_NFC_HELPER_BASE_URL}/status`);
  assert.equal(calls[2].token, newToken);
  assert.equal(values.get(AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY), newToken);
});

test("invalid saved token without a fresh shortcut code requires maintenance without clearing trust", async () => {
  let clearCalls = 0;
  let pairCalls = 0;
  await assert.rejects(
    connectAiGraderNfcHelper(
      { readiness: readyHostedNfc },
      {
        hasPairing: () => true,
        clearPairing: () => { clearCalls += 1; },
        status: async () => {
          throw new AiGraderNfcHelperError(
            "workstation_token_invalid",
            "Pair this NFC workstation before programming.",
            401,
          );
        },
        pair: async () => { pairCalls += 1; return readyHelperStatus; },
      },
    ),
    (error: unknown) => error instanceof AiGraderNfcHelperError && error.code === "workstation_token_invalid",
  );
  assert.equal(clearCalls, 0);
  assert.equal(pairCalls, 0);
});

test("ready bootstrap never treats helper unavailability as a token-rotation signal", async () => {
  let clearCalls = 0;
  let pairCalls = 0;
  await assert.rejects(
    connectAiGraderNfcHelper(
      { readiness: readyHostedNfc, pairingCode: "FreshPairCode123" },
      {
        hasPairing: () => true,
        clearPairing: () => { clearCalls += 1; },
        status: async () => {
          throw new AiGraderNfcHelperError("NFC_HELPER_UNAVAILABLE", "Helper unavailable.", 503, undefined, true);
        },
        pair: async () => { pairCalls += 1; return readyHelperStatus; },
      },
    ),
    (error: unknown) => error instanceof AiGraderNfcHelperError && error.code === "NFC_HELPER_UNAVAILABLE",
  );
  assert.equal(clearCalls, 0);
  assert.equal(pairCalls, 0);
});

test("ready bootstrap automatically pairs only with a valid in-memory shortcut code", async () => {
  let pairedWith = "";
  let statusCalls = 0;
  const result = await connectAiGraderNfcHelper(
    { readiness: readyHostedNfc, pairingCode: "  PairCode123  " },
    {
      hasPairing: () => false,
      status: async () => { statusCalls += 1; return readyHelperStatus; },
      pair: async (pairingCode) => { pairedWith = pairingCode; return readyHelperStatus; },
    },
  );
  assert.deepEqual(result, { state: "connected", status: readyHelperStatus, pairedNow: true });
  assert.equal(pairedWith, "PairCode123");
  assert.equal(statusCalls, 0);
});

test("bootstrap rejects a helper protocol mismatch", async () => {
  await assert.rejects(
    connectAiGraderNfcHelper(
      { readiness: readyHostedNfc },
      {
        hasPairing: () => true,
        status: async () => ({ ...readyHelperStatus, helperProtocolVersion: "unexpected" }),
      },
    ),
    (error: unknown) => error instanceof AiGraderNfcHelperError && error.code === "NFC_HELPER_PROTOCOL_MISMATCH",
  );
});

test("invalid shortcut pairing code is rejected before fetch", async () => {
  installWindow();
  clearAiGraderNfcHelperPairing();
  let fetchCalls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
  });
  await assert.rejects(
    connectAiGraderNfcHelper({ readiness: readyHostedNfc, pairingCode: "not valid!" }),
    (error: unknown) => error instanceof AiGraderNfcHelperError && error.code === "NFC_HELPER_PAIRING_CODE_INVALID",
  );
  assert.equal(fetchCalls, 0);
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

test("browser reload after hosted F8215 completion cleans only the matching completed local attempt", async () => {
  const attemptId = "nfc_attempt_" + "A".repeat(43);
  const url = "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345";
  let acknowledged = "";
  const result = await reconcileAiGraderF8215HostedActivation(
    { status: "active", activeAttemptId: attemptId, chipType: "FEIJU_F8215", nfcTagUrl: url },
    {
      status: async () => ({
        helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
        attemptId,
        chipType: "FEIJU_F8215",
        programmingProfile: "gototags_manual_start_v1",
        phase: "completed",
        terminal: true,
        retryable: false,
        evidence: {
          helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
          chipType: "FEIJU_F8215",
          securityMode: "static_url_v1",
          programmingProfile: "gototags_manual_start_v1",
          adapterIdentity: "gototags_desktop",
          adapterVersion: "4.37.0.1",
          normalizedUrl: url,
          uidFingerprintSha256: "a".repeat(64),
          readbackPayloadSha256: "b".repeat(64),
          writeProtectionState: "permanently_read_only_verified",
          readerResultCode: "write_locked_verified_gototags_readback",
          operationalAttestation: {
            schemaVersion: "ai-grader-nfc-helper-attestation-v2",
            workstationKeyId: "c".repeat(64),
            algorithm: "ecdsa-p256-sha256-p1363",
            attestationChallenge: "D".repeat(43),
            observedAt: "2026-07-16T20:00:00.000Z",
            signature: "E".repeat(86),
          },
        },
      }),
      acknowledge: async (exactAttemptId) => {
        acknowledged = exactAttemptId;
        return { helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION, attemptId: exactAttemptId, cleaned: true };
      },
    },
  );
  assert.equal(result, "cleaned");
  assert.equal(acknowledged, attemptId);
});

test("hosted activation recovery protects a mismatched local attempt and permits already-clean state", async () => {
  const attemptId = "nfc_attempt_" + "A".repeat(43);
  const otherAttemptId = "nfc_attempt_" + "B".repeat(43);
  const hosted = {
    status: "active" as const,
    activeAttemptId: attemptId,
    chipType: "FEIJU_F8215" as const,
    nfcTagUrl: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
  };
  let acknowledged = false;
  await assert.rejects(
    reconcileAiGraderF8215HostedActivation(hosted, {
      status: async () => ({
        helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION,
        attemptId: otherAttemptId,
        chipType: "FEIJU_F8215",
        programmingProfile: "gototags_manual_start_v1",
        phase: "completed",
        terminal: true,
        retryable: false,
        evidence: null,
      }),
      acknowledge: async () => {
        acknowledged = true;
        return { helperProtocolVersion: AI_GRADER_NFC_HELPER_PROTOCOL_VERSION, attemptId, cleaned: true };
      },
    }),
    (error: unknown) => error instanceof AiGraderNfcHelperError && error.code === "NFC_HOSTED_LOCAL_RECOVERY_MISMATCH",
  );
  assert.equal(acknowledged, false);
  const absent = await reconcileAiGraderF8215HostedActivation(hosted, {
    status: async () => { throw new AiGraderNfcHelperError("gototags_job_not_found", "missing", 404); },
  });
  assert.equal(absent, "already_absent");
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
