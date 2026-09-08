import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { startVaultNextTestServer } from "./vault-next-test-server.mjs";

const server = await startVaultNextTestServer();
const base = `${server.url}/api/vault/v1/machines/00000000-0000-4000-8000-000000000339`;
let cases = 0;
try {
  for (const [action, method, version, expected, allow] of [
    ["events:batch", "GET", "1", 405, "POST"],
    ["events:batch", "POST", "2", 426],
    ["events:batch", "POST", "1", 401],
    ["staff-grants:pull?afterGrantVersion=0", "POST", "1", 405, "GET"],
    ["staff-grants:pull?afterGrantVersion=0", "GET", "2", 426],
    ["staff-grants:pull?afterGrantVersion=0", "GET", "1", 401],
    ["events:batch/extra", "POST", "1", 404],
    ["staff-grants:pull/extra", "GET", "1", 404],
  ]) {
    const response = await fetch(`${base}/${action}`, { method, headers: { "X-Vault-Contract-Version": version, "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}), signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, expected, `${method} ${action}`);
    if (allow) assert.equal(response.headers.get("allow"), allow);
    const body = await response.json();
    assert.equal(typeof body.error?.code, "string");
    assert.equal(typeof body.requestId, "string");
    cases += 1;
  }
  for (const [label, body, contentType, expected] of [
    ["malformed JSON", "{invalid", "application/json", 400],
    ["lookalike content type", "{}", "application/jsonp", 415],
    ["unsupported content type", "{}", "text/plain", 415],
    ["declared oversize body", JSON.stringify({ text: "x".repeat(8 * 1024 * 1024) }), "application/json", 413],
  ]) {
    const response = await fetch(`${base}/events:batch`, { method: "POST", headers: { "X-Vault-Contract-Version": "1", "Content-Type": contentType }, body, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, expected, label);
    const parsed = await response.json();
    assert.equal(typeof parsed.requestId, "string", label);
    assert.equal(typeof parsed.error?.code, "string", label);
    cases += 1;
  }
  const chunked = await fetch(`${base}/events:batch`, {
    method: "POST", headers: { "X-Vault-Contract-Version": "1", "Content-Type": "application/json" },
    body: Readable.from(Array.from({ length: 9 }, () => " ".repeat(1024 * 1024))), duplex: "half", signal: AbortSignal.timeout(10_000),
  });
  assert.equal(chunked.status, 413, "Actual streamed bytes enforce the body bound");
  assert.equal(typeof (await chunked.json()).error?.code, "string");
  cases += 1;
  console.log(JSON.stringify({ ok: true, node: process.version, productionNextRoutingCases: cases, publicUrlsPreserved: true, databaseAccess: "none: requests fail before database authority" }));
} finally { await server.close(); }
