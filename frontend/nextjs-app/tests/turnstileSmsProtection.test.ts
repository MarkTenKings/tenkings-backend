import assert from "node:assert/strict";
import test from "node:test";
import { requestLoginCode } from "../lib/api";

test("login-code requests send the Turnstile token with the phone number", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestBody: unknown = null;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "http://localhost:8088/send-code");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ status: "sent" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await requestLoginCode("+15555550123", "single-use-turnstile-token");

  assert.deepEqual(requestBody, {
    phone: "+15555550123",
    turnstileToken: "single-use-turnstile-token",
  });
  assert.deepEqual(result, { status: "sent" });
});
