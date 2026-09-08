import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

assert.equal(process.versions.node.split(".")[0], "20", "Vault simulator requires Node 20");
const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const contracts = require("../packages/vault-contracts/dist");
const vault = require("../packages/vault-machine/dist");
const { makeSyntheticConfig } = require("../packages/vault-contracts/tests/profile-fixtures.js");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const smoke = args.includes("--smoke");
const at = args.indexOf("--doors");
const count = at < 0 ? 72 : Number(args[at + 1]);
assert.ok(args.every((arg, index) => arg === "--smoke" || arg === "--doors" || index === at + 1 && at >= 0), "Usage: pnpm vault:demo -- --doors 72 [--smoke]");
assert.ok([72, 125].includes(count), "Demo provides only explicitly synthetic 72- or 125-door fixtures");
const staticRoot = resolve(root, "frontend/vault-kiosk/dist");
assert.ok(existsSync(resolve(staticRoot, "index.html")), "Build the Vault kiosk before starting the simulator");
const machineId = randomUUID(), keys = generateKeyPairSync("ed25519");
const signedConfig = makeSyntheticConfig(machineId, 1, keys.privateKey, count);
const now = Date.now();
signedConfig.payload.createdAt = new Date(now - 60_000).toISOString();
signedConfig.payload.expiresAt = new Date(now + 24 * 3600_000).toISOString();
signedConfig.digest = contracts.configDigest(signedConfig.payload);
signedConfig.signature = sign(null, Buffer.from(contracts.canonicalJson(signedConfig.payload)), keys.privateKey).toString("base64");
const grant = {
  grantId: randomUUID(), userId: "simulator-tech", machineId, role: "TECHNICIAN", verifierVersion: 1, grantVersion: 1,
  verifier: vault.createScryptPinVerifier("123456"), hashAlgorithm: "scrypt", hashParameters: { N: 16384, r: 8, p: 1 },
  validFrom: signedConfig.payload.createdAt, expiresAt: signedConfig.payload.expiresAt, revokedAt: null,
};
const events = new Map(); let nextSequence = 1;
const credential = `synthetic-${randomUUID()}`;
const mockFetch = async (url, options) => {
  const path = new URL(url);
  assert.equal(path.origin, "https://vault-simulator.invalid");
  assert.equal(new Headers(options.headers).get("authorization"), `VaultMachine ${credential}`);
  const prefix = `/api/vault/v1/machines/${machineId}/`;
  assert.ok(path.pathname.startsWith(prefix));
  const action = path.pathname.slice(prefix.length);
  const response = (value, status = 200) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  if (action === "config" && options.method === "GET") return new Headers(options.headers).get("if-none-match") === `"${signedConfig.digest}"` ? response(null, 304) : response({ config: signedConfig });
  if (action === "staff-grants:pull" && options.method === "GET") {
    const after = Number(path.searchParams.get("afterGrantVersion"));
    return response({ grants: after < 1 ? [grant] : [], latestGrantVersion: Math.max(1, after), hasMore: false });
  }
  if (action === "heartbeat" && options.method === "POST") {
    contracts.VaultHeartbeatSchema.parse(JSON.parse(options.body));
    return response({ accepted: true, machine: { id: machineId }, serverObservedAt: new Date().toISOString() });
  }
  if (action === "events:batch" && options.method === "POST") {
    const batch = contracts.VaultEventBatchSchema.parse(JSON.parse(options.body));
    for (const event of batch.events) {
      assert.equal(event.mode, "CERTIFICATION");
      const bytes = contracts.canonicalJson(event);
      if (events.has(event.eventId)) assert.equal(events.get(event.eventId), bytes);
      else { assert.equal(event.sequence, nextSequence++); events.set(event.eventId, bytes); }
    }
    return response({ acknowledgedEventIds: batch.events.map((event) => event.eventId), rejected: [] });
  }
  return response({ error: "UNKNOWN_SIMULATOR_PATH" }, 404);
};

const allocation = createServer();
await new Promise((done, reject) => { allocation.once("error", reject); allocation.listen(0, "127.0.0.1", done); });
const port = allocation.address().port;
await new Promise((done) => allocation.close(done));
const origin = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(resolve(tmpdir(), "vault-disposable-simulator-"));
let store, payment, service, runtime, closing = false;
const close = async () => {
  if (closing) return; closing = true;
  try { await runtime?.stop(); }
  finally {
    try { if (service?.server.listening) await service.close(); }
    finally { try { payment?.close(); } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); } }
  }
};
try {
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  store = new vault.VaultStore(resolve(directory, "machine.sqlite"), { machineId, appVersion: "0.1.0", sourceCommit });
  payment = new vault.DurableNayaxMock(resolve(directory, "provider.sqlite"), machineId);
  const controller = new vault.DeterministicControllerSimulator(signedConfig.payload.doorMapping);
  const machine = new vault.VaultMachine(store, payment, controller, { clock: vault.systemClock, appVersion: "0.1.0", pinnedConfigKeys: { "test-key": keys.publicKey.export({ type: "spki", format: "pem" }) }, beforeCheckout: () => runtime.proveCheckoutReachability() });
  await machine.initialize();
  service = new vault.VaultHttpService(machine, new vault.VaultOperationsService(machine, vault.systemClock), { origin, host: "127.0.0.1", port, staticRoot, adapterCallbackToken: randomUUID(), clock: vault.systemClock });
  await service.listen();
  runtime = new vault.VaultRuntime(machine, new vault.VaultCloudClient({ origin: "https://vault-simulator.invalid", machineId, credential: () => credential, fetch: mockFetch }), { clock: vault.systemClock, broadcast: () => service.broadcastState() });
  await runtime.synchronize();
  if (smoke) {
    let cookie = "";
    const call = async (path, body) => {
      const stateVersion = body !== undefined && cookie ? (await call("/api/v1/state")).stateVersion : undefined;
      const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Vault-Contract-Version": "1", ...(cookie ? { Cookie: cookie } : {}), ...(stateVersion === undefined ? {} : { "If-Match": String(stateVersion) }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result)); return result.data;
    };
    await call("/api/v1/session/bootstrap", {});
    const state = await call("/api/v1/state");
    assert.equal(state.doors.length, count); assert.equal(state.mode, "CERTIFICATION");
    const actor = await call("/api/v1/staff/authenticate", { userId: grant.userId, pin: "123456" });
    const doorId = signedConfig.payload.machineProfile.doors[0].doorId;
    const restock = await call("/api/v1/restocks", { staffSessionId: actor.sessionId, doorIds: [doorId] });
    await call(`/api/v1/restocks/${restock.sessionId}/items/${doorId}`, { staffSessionId: actor.sessionId, outcome: "FILLED", productFitConfirmed: true, notes: "Synthetic product-fit confirmation" });
    await call(`/api/v1/restocks/${restock.sessionId}/finalize`, { staffSessionId: actor.sessionId, servicedDoorsClosed: true });
    await call("/api/v1/staff/safe-exit", { staffSessionId: actor.sessionId, servicedDoorsClosed: true });
    await call("/api/v1/cart/select", { doorId, productId: "sports-25", selected: true });
    const checkout = await call("/api/v1/checkout", { idempotencyKey: randomUUID(), mode: "CERTIFICATION", configVersion: 1, doorIds: [doorId] });
    const saleId = checkout.activeSale.saleId;
    await call(`/api/v1/sales/${saleId}/payment`, { idempotencyKey: randomUUID() });
    await runtime.tickLocal();
    await call(`/api/v1/sales/${saleId}/open-doors`, { idempotencyKey: randomUUID() });
    await call(`/api/v1/sales/${saleId}/done`, {});
    await runtime.synchronize();
    console.log(JSON.stringify({ ok: true, syntheticDoors: count, publicHttpRestockCheckoutPaymentRetry: true, eventCount: events.size, realNetworkHardwarePayment: false }));
    await close();
  } else {
    runtime.start();
    console.log(`Synthetic ${count}-door Vault simulator: ${origin}\nTest staff: simulator-tech / PIN 123456. Use the ten-tap staff corner to restock, then safe exit and shop.\nAll payments, doors, dimensions and cloud responses are simulated. Press Ctrl+C to stop and remove this disposable session.`);
    process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
  }
} catch (error) { await close(); throw error; }
