import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_NFC_HELPER_BASE_URL,
  AI_GRADER_NFC_HELPER_TOKEN_STORAGE_KEY,
  clearAiGraderNfcHelperPairing,
  getAiGraderNfcHelperStatus,
  pairAiGraderNfcHelper,
  writeAiGraderNfcTag,
} from "../lib/aiGraderNfcHelperClient";

function installWindow() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string) { return values.get(key) ?? null; },
        setItem(key: string, value: string) { values.set(key, value); },
        removeItem(key: string) { values.delete(key); },
      },
    },
  });
  return values;
}

test("NFC helper pairing uses its distinct loopback token and exact fixed base URL", async () => {
  const values = installWindow();
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
  const values = installWindow();
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
    url: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
    overwriteConfirmation: { confirmed: true, observedPayloadSha256: "a".repeat(64) },
  });
  assert.deepEqual(Object.keys(captured ?? {}).sort(), ["attemptId", "idempotencyKey", "overwriteConfirmation", "url"]);
  assert.equal("apdu" in (captured ?? {}), false);
  assert.equal("rawUid" in (captured ?? {}), false);
});
