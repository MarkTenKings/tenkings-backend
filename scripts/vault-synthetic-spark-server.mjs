import assert from "node:assert/strict";
import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const SYNTHETIC_SPARK_ORIGIN = "https://spark.synthetic.invalid";
export const SYNTHETIC_SPARK_TOKEN = "SyntheticToken_0123456789abcdefghijklmNOPQRSTUVWXYZ";
export const SYNTHETIC_SPARK_KEY = "SyntheticOnlySigningKey0000000001";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? `__int64_${item}__` : item).replace(/"__int64_([0-9]+)__"/g, "$1");
const loopback = (value) => { const url = new URL(value); assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1"); return url; };

/** A real loopback wire peer. No provider endpoint or control endpoint is exposed. */
export async function startSyntheticSparkServer(bindings) {
  const sessions = new Map(), calls = [], errors = [];
  let callbackOrigin, callbackSecret, responseMode = "normal", nextTransaction = 9007199254740993n;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      const method = req.url?.split("/").at(-1);
      assert.ok(["StartAuthentication", "TriggerTransaction", "CancelTransaction"].includes(method));
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; assert.ok(size < 65536); chunks.push(chunk); }
      const raw = Buffer.concat(chunks).toString("utf8");
      // Synthetic IDs used in requests stay strings; CancelTransaction's int64 is
      // separately compared using its exact wire digits, never the parsed Number.
      const body = JSON.parse(raw);
      const binding = bindings.find(item => item.terminalId === body.TerminalId);
      assert.ok(binding, "Unknown synthetic terminal");
      assert.equal(req.headers.integratorid, "927");
      let id = body.SparkTransactionId;
      if (method === "StartAuthentication") {
        assert.equal(body.TokenId, 116383);
        const decipher = createDecipheriv("aes-256-ecb", Buffer.from(SYNTHETIC_SPARK_TOKEN.slice(-32)), null);
        const plaintext = Buffer.concat([decipher.update(Buffer.from(body.Cipher, "base64")), decipher.final()]).toString();
        id = plaintext.slice(0, 36);
        assert.match(id, /^[a-f0-9-]{36}$/);
        assert.match(body.Random, /^[A-Za-z0-9]{17}$/);
        assert.equal(plaintext.slice(36, 54), `=${body.Random}`);
        assert.match(plaintext.slice(54), /^\d{10}$/);
        if (body.SparkTransactionId !== undefined) assert.equal(body.SparkTransactionId, id);
      }
      const expected = sha256(`${req.headers.signature ? raw : id};${SYNTHETIC_SPARK_KEY}`);
      const supplied = req.headers.signature ?? req.headers.transactionsignature;
      assert.equal(typeof supplied, "string"); assert.equal(supplied.length, expected.length);
      assert.ok(timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)), "Signature must authenticate exact request");
      const record = { method, sparkTransactionId: id, machineId: binding.machineId, wireDigest: sha256(raw), signatureProfile: req.headers.signature ? "MANUAL_BODY_SHA256" : "CURRENT_GUID_SHA256" };
      calls.push(record);
      if (method === "StartAuthentication") {
        assert.ok(!sessions.has(id), "Authentication may not silently recreate a session");
        sessions.set(id, { id, binding, nayaxId: String(nextTransaction++), machineAuTime: new Date().toISOString().replace(/[-T:.Z]/g, ""), triggered: false, voided: false });
      } else {
        const session = sessions.get(id); assert.ok(session, "Request requires authenticated session");
        assert.equal(session.binding, binding);
        if (method === "TriggerTransaction") {
          assert.equal(body.TransactionTimeout, 60); assert.ok(body.Amount > 0); assert.equal(body.TerminalIdType, 1);
          if (session.triggered) assert.equal(session.triggerWireDigest, sha256(raw), "Replay must preserve exact body");
          session.triggered = true; session.amountCents = Math.round(body.Amount * 100); session.triggerWireDigest = sha256(raw);
        } else {
          assert.equal(body.CancellationType, 2); assert.equal(body.MachineAuTime, session.machineAuTime);
          assert.equal(body.SiteId, binding.siteId); assert.equal(Math.round(body.CancelAmount * 100), session.amountCents);
          assert.equal(/"NayaxTransactionId":([0-9]+)/.exec(raw)?.[1], session.nayaxId);
          assert.ok(session.captured, "Only exact captured sales can be voided");
          session.voided = true;
        }
      }
      const selectedMode = responseMode; responseMode = "normal";
      if (selectedMode === "disconnect") { req.socket.destroy(); return; }
      res.setHeader("Content-Type", "application/json");
      if (selectedMode === "malformed") { res.end('{"Status":'); return; }
      res.end(json(method === "StartAuthentication" ? { HashedSparkTransactionId: sha256(id), Status: { Verdict: "Approved" } } : { SparkTransactionId: id, Status: { Verdict: "Approved" } }));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Synthetic validation failed");
      res.statusCode = 422; res.end(JSON.stringify({ error: "SYNTHETIC_WIRE_VALIDATION_FAILED" }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, sessions, calls, errors,
    configureCallbacks(url, secret) { callbackOrigin = loopback(url).origin; assert.ok(secret.startsWith("synthetic_")); callbackSecret = secret; },
    failNext(mode) { assert.ok(["disconnect", "malformed"].includes(mode)); responseMode = mode; },
    async fetch(url, options) {
      const target = new URL(url); assert.equal(target.origin, SYNTHETIC_SPARK_ORIGIN);
      assert.ok(target.pathname.startsWith("/api/"));
      return fetch(`${origin}${target.pathname}`, options);
    },
    callback(id, patch = {}, kind = "TransactionCallback") {
      const session = sessions.get(id); assert.ok(session?.triggered);
      return kind === "DeclineCallback" ? { SparkTransactionId: id, MachineId: BigInt(session.binding.nayaxMachineId), HwSerial: session.binding.hwSerial, Status: { Verdict: "Declined", ErrorCode: 44 }, ...patch }
        : { SparkTransactionId: id, NayaxTransactionId: BigInt(session.nayaxId), MachineId: BigInt(session.binding.nayaxMachineId), TerminalId: session.binding.hwSerial,
            HwSerial: session.binding.hwSerial, SiteId: session.binding.siteId, Amount: session.amountCents / 100, CurrencyCode: "USD", MachineAuTime: session.machineAuTime,
            AuthStatus: { Verdict: "Approved", ErrorCode: 0 }, CardBrand: "VISA", AuthCode: "SYNTHETIC", NayaxRRN: "SYNTHETIC", ...patch };
    },
    async sendCallback(body, kind = "TransactionCallback", options = {}) {
      assert.ok(callbackOrigin); const response = await fetch(`${callbackOrigin}/api/vault/v1/spark/${kind}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", "x-vault-spark-secret": options.secret ?? callbackSecret }, body: options.raw ?? json(body) });
      if (response.status === 200 && kind === "TransactionCallback" && body.AuthStatus?.Verdict === "Approved") { const session = sessions.get(body.SparkTransactionId); if (session) session.captured = true; }
      return { status: response.status, body: await response.text() };
    },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
