import assert from "node:assert/strict";
import test from "node:test";
import {
  TURNSTILE_SEND_CODE_ACTION,
  TURNSTILE_SITEVERIFY_URL,
  type TurnstileFetch,
  verifyTurnstileToken,
} from "./turnstile.js";

const expectedHostname = "collect.tenkings.co";

const responseWith = (payload: unknown, ok = true): TurnstileFetch => async (input, init) => {
  assert.equal(input, TURNSTILE_SITEVERIFY_URL);
  assert.equal(init.method, "POST");
  assert.equal(init.headers && (init.headers as Record<string, string>)["Content-Type"], "application/json");
  return {
    ok,
    async json() {
      return payload;
    },
  };
};

test("accepts a valid token for the expected hostname and action", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const fetchImpl: TurnstileFetch = async (input, init) => {
    assert.equal(input, TURNSTILE_SITEVERIFY_URL);
    requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return {
      ok: true,
      async json() {
        return {
          success: true,
          hostname: expectedHostname,
          action: TURNSTILE_SEND_CODE_ACTION,
          "error-codes": [],
        };
      },
    };
  };

  const result = await verifyTurnstileToken({
    secretKey: "secret-value",
    token: "browser-token",
    expectedHostname,
    fetchImpl,
  });

  assert.deepEqual(requestBody, { secret: "secret-value", response: "browser-token" });
  assert.deepEqual(result, {
    success: true,
    hostname: expectedHostname,
    action: TURNSTILE_SEND_CODE_ACTION,
  });
});

test("rejects tokens issued on another hostname", async () => {
  const result = await verifyTurnstileToken({
    secretKey: "secret-value",
    token: "browser-token",
    expectedHostname,
    fetchImpl: responseWith({
      success: true,
      hostname: "attacker.example",
      action: TURNSTILE_SEND_CODE_ACTION,
    }),
  });

  assert.deepEqual(result, { success: false, reason: "hostname-mismatch", errorCodes: [] });
});

test("rejects tokens issued for another action", async () => {
  const result = await verifyTurnstileToken({
    secretKey: "secret-value",
    token: "browser-token",
    expectedHostname,
    fetchImpl: responseWith({ success: true, hostname: expectedHostname, action: "contact_form" }),
  });

  assert.deepEqual(result, { success: false, reason: "action-mismatch", errorCodes: [] });
});

test("preserves Cloudflare rejection codes without accepting the request", async () => {
  const result = await verifyTurnstileToken({
    secretKey: "secret-value",
    token: "spent-token",
    expectedHostname,
    fetchImpl: responseWith({ success: false, "error-codes": ["timeout-or-duplicate"] }),
  });

  assert.deepEqual(result, {
    success: false,
    reason: "challenge-rejected",
    errorCodes: ["timeout-or-duplicate"],
  });
});

test("fails closed when Siteverify is unavailable", async () => {
  const fetchImpl: TurnstileFetch = async () => {
    throw new Error("network unavailable");
  };

  const result = await verifyTurnstileToken({
    secretKey: "secret-value",
    token: "browser-token",
    expectedHostname,
    fetchImpl,
  });

  assert.deepEqual(result, { success: false, reason: "siteverify-unavailable", errorCodes: [] });
});

test("rejects missing or oversized tokens without calling Siteverify", async () => {
  let calls = 0;
  const fetchImpl: TurnstileFetch = async () => {
    calls += 1;
    return responseWith({})("", {});
  };

  const missing = await verifyTurnstileToken({ secretKey: "secret-value", token: "", expectedHostname, fetchImpl });
  const oversized = await verifyTurnstileToken({
    secretKey: "secret-value",
    token: "x".repeat(2_049),
    expectedHostname,
    fetchImpl,
  });

  assert.equal(calls, 0);
  assert.equal(missing.success, false);
  assert.equal(oversized.success, false);
});

test('explicit additional hosts preserve the existing collect/legacy hostname', async () => {
  const { resolveTurnstileHostnames } = await import('./turnstile.js');
  assert.deepEqual(resolveTurnstileHostnames(), ['collect.tenkings.co']);
  assert.deepEqual(resolveTurnstileHostnames(undefined, 'tenkings.co,preview.tenkings.co'), ['collect.tenkings.co', 'tenkings.co', 'preview.tenkings.co']);
  assert.deepEqual(resolveTurnstileHostnames('other.example', 'TENKINGS.CO,tenkings.co'), ['other.example', 'tenkings.co']);
  for (const value of ['', '*.tenkings.co', 'https://tenkings.co', 'tenkings.co/path', 'tenkings.co:443', 'tenkings.co,', '-bad.tenkings.co', 'tenkings..co']) assert.deepEqual(resolveTurnstileHostnames(undefined, value), []);
});

test('multi-origin login checks exact provider host and action, without trusting subdomains', async () => {
  const allowedHostnames = ['collect.tenkings.co', 'tenkings.co', 'preview.tenkings.co'];
  for (const hostname of [...allowedHostnames, 'TENKINGS.CO']) {
    assert.equal((await verifyTurnstileToken({ secretKey: 'secret', token: 'token', allowedHostnames, fetchImpl: responseWith({ success: true, hostname, action: TURNSTILE_SEND_CODE_ACTION }) })).success, true);
  }
  for (const hostname of ['www.tenkings.co', 'tenkings.co.evil.example', 'evil.tenkings.co', '', undefined, 'tenkings.co.']) {
    assert.equal((await verifyTurnstileToken({ secretKey: 'secret', token: 'token', allowedHostnames, fetchImpl: responseWith({ success: true, hostname, action: TURNSTILE_SEND_CODE_ACTION }) })).success, false);
  }
  assert.deepEqual(await verifyTurnstileToken({ secretKey: 'secret', token: 'token', allowedHostnames, fetchImpl: responseWith({ success: true, hostname: 'tenkings.co', action: 'other' }) }), { success: false, reason: 'action-mismatch', errorCodes: [] });
});

test('missing or malformed allowed-host configuration fails before provider work', async () => {
  for (const allowedHostnames of [[], ['*.tenkings.co'], ['tenkings.co', ''], ['https://tenkings.co']]) {
    assert.deepEqual(await verifyTurnstileToken({ secretKey: 'secret', token: 'token', allowedHostnames, fetchImpl: async () => { assert.fail('invalid host config must not reach provider'); } }), { success: false, reason: 'hostname-mismatch', errorCodes: [] });
  }
});
