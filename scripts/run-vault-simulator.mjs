import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { simulatorSourceIdentity } from "./vault-simulator-source.mjs";
import { preflight as stripePreflight } from "./vault-stripe-sandbox.mjs";

assert.ok(["20", "22"].includes(process.versions.node.split(".")[0]), "Vault simulator requires Node 20 compatibility or Node 22 Linux runtime");
const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const contracts = require("../packages/vault-contracts/dist");
const vault = require("../packages/vault-machine/dist");
const { makeSyntheticConfig } = require("../packages/vault-contracts/tests/profile-fixtures.js");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const smoke = args.includes("--smoke");
const stocked = args.includes("--stocked");
const cinematic = args.includes("--cinematic");
const stripeTest = args.includes("--stripe-test");
const at = args.indexOf("--doors");
const count = at < 0 ? 72 : Number(args[at + 1]);
const portAt = args.indexOf("--port");
const requestedPort = portAt < 0 ? 0 : Number(args[portAt + 1]);
const manifestAt = args.indexOf("--source-manifest");
const sourceManifest = manifestAt < 0 ? undefined : args[manifestAt + 1];
assert.ok(manifestAt < 0 || sourceManifest && !sourceManifest.startsWith("--"), "--source-manifest requires the candidate manifest path");
assert.ok(args.every((arg, index) => ["--cinematic", "--smoke", "--stocked", "--stripe-test", "--doors", "--port", "--source-manifest"].includes(arg) || index === at + 1 && at >= 0 || index === portAt + 1 && portAt >= 0 || index === manifestAt + 1 && manifestAt >= 0), "Usage: pnpm vault:demo -- --doors 72 [--stocked] [--cinematic] [--smoke] [--stripe-test] [--port 55497] [--source-manifest /path/to/candidate-source.json]");
assert.ok(!stripeTest || stocked && !smoke, "Stripe touchscreen bench requires --stocked and cannot use mock smoke automation");
assert.ok([72, 125].includes(count), "Demo provides only explicitly synthetic 72- or 125-door fixtures");
assert.ok(Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535, "Port must be an integer from 0 to 65535; 0 chooses an available port");
const staticRoot = resolve(root, "frontend/vault-kiosk/dist");
assert.ok(existsSync(resolve(staticRoot, "index.html")), "Build the Vault kiosk before starting the simulator");
const machineId = randomUUID(), keys = generateKeyPairSync("ed25519");
const signedConfig = makeSyntheticConfig(machineId, 1, keys.privateKey, count);
if (stocked) {
  signedConfig.payload.products = [2500, 5000, 10000, 25000].flatMap((priceCents) => ["SPORTS", "POKEMON"].map((category) => ({
    id: `${category.toLowerCase()}-${priceCents / 100}`,
    name: `${category === "SPORTS" ? "Sports" : "Pokémon"} Mystery Pack - $${priceCents / 100}`,
    photoUrl: "https://example.test/preview-pack.jpg",
    description: stripeTest ? "Stripe Test mode payment and simulated door. No real charge or physical unlock." : "Preview product. Payments and door openings are simulated.",
    category, priceCents, taxClass: "GENERAL", active: true,
  })));
  signedConfig.payload.assignments = Object.fromEntries(signedConfig.payload.machineProfile.doors.map((door, index) => [door.doorId, signedConfig.payload.products[index % signedConfig.payload.products.length].id]));
}
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
const stripeSecret = stripeTest ? process.env.VAULT_STRIPE_TEST_SECRET_KEY : undefined;
const stripeReaderId = stripeTest ? process.env.VAULT_STRIPE_TEST_READER_ID : undefined;
const stripeLocationId = stripeTest ? process.env.VAULT_STRIPE_TEST_LOCATION_ID : undefined;
if (stripeTest) {
  assert.ok(/^rk_test_[A-Za-z0-9_]+$/.test(stripeSecret ?? ""), "A restricted Stripe test key is required");
  assert.ok(/^tmr_[A-Za-z0-9]+$/.test(stripeReaderId ?? ""), "A test reader ID is required");
  assert.ok(/^tml_[A-Za-z0-9]+$/.test(stripeLocationId ?? ""), "A test Location ID is required");
}
const stripeApi = async (method, path, fields) => {
  let response;
  try {
    response = await fetch(`https://api.stripe.com${path}`, {
      method, redirect: "error", headers: { Authorization: `Bearer ${stripeSecret}`, ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(fields ? { body: new URLSearchParams(fields) } : {}), signal: AbortSignal.timeout(12000),
    });
  } catch { throw new Error("STRIPE_TEST_NETWORK_OUTCOME_UNKNOWN"); }
  if (!response.ok) throw new Error(`STRIPE_TEST_HTTP_${response.status}`);
  try { return await response.json(); } catch { throw new Error("STRIPE_TEST_RESPONSE_INVALID"); }
};
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
await new Promise((done, reject) => { allocation.once("error", reject); allocation.listen(requestedPort, "127.0.0.1", done); });
const port = allocation.address().port;
await new Promise((done) => allocation.close(done));
const origin = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(resolve(tmpdir(), "vault-disposable-simulator-"));
let store, payment, service, runtime, cardPump, cardPumpTask = Promise.resolve(), closing = false;
const close = async () => {
  if (closing) return; closing = true;
  if (cardPump) clearInterval(cardPump);
  await cardPumpTask;
  try { await runtime?.stop(); }
  finally {
    try {
      if (stripeTest && store) {
        try {
          const sales = store.all("SELECT sale_id,provider_session_id,payment_state,state FROM sale ORDER BY created_at").map((row) => ({
            saleId: row.sale_id, paymentIntentId: row.provider_session_id, paymentState: row.payment_state, saleState: row.state,
            simulatedDoorCommands: Number(store.one("SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=?", row.sale_id).count),
            acceptedSimulatedDoorCommands: Number(store.one("SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=? AND state='ACCEPTED'", row.sale_id).count),
          }));
          console.log(JSON.stringify({ phase: "stripe-touchscreen-bench-summary", sales, physicalDoorActuation: false }));
        } catch { console.error("STRIPE_TOUCHSCREEN_BENCH_SUMMARY_UNAVAILABLE"); }
      }
      if (service?.server.listening) await service.close();
    }
    finally { try { payment?.close(); } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); } }
  }
};
try {
  const sourceIdentity = simulatorSourceIdentity(root, sourceManifest);
  if (stripeTest) {
    const checked = await stripePreflight({ readerId: stripeReaderId, locationId: stripeLocationId }, stripeApi);
    console.log(JSON.stringify({ phase: "stripe-touchscreen-bench-preflight", ...checked }));
  }
  store = new vault.VaultStore(resolve(directory, "machine.sqlite"), { machineId, appVersion: "0.1.0", sourceCommit: sourceIdentity.sourceCommit });
  payment = stripeTest
    ? new vault.StripeTerminalTestAdapter({ secretKey: stripeSecret, machineId, readerId: stripeReaderId, locationId: stripeLocationId })
    : new vault.DurablePaymentMock(resolve(directory, "provider.sqlite"), machineId);
  const controller = new vault.DeterministicControllerSimulator(signedConfig.payload.doorMapping);
  const machine = new vault.VaultMachine(store, payment, controller, { clock: vault.systemClock, appVersion: "0.1.0", pinnedConfigKeys: { "test-key": keys.publicKey.export({ type: "spki", format: "pem" }) }, beforeCheckout: () => runtime.proveCheckoutReachability() });
  await machine.initialize();
  service = new vault.VaultHttpService(machine, new vault.VaultOperationsService(machine, vault.systemClock), { origin, host: "127.0.0.1", port, staticRoot, adapterCallbackToken: randomUUID(), clock: vault.systemClock });
  await service.listen();
  runtime = new vault.VaultRuntime(machine, new vault.VaultCloudClient({ origin: "https://vault-simulator.invalid", machineId, credential: () => credential, fetch: mockFetch }), { clock: vault.systemClock, broadcast: () => service.broadcastState() });
  await runtime.synchronize();
  if (smoke || stocked) {
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
    const seedDoors = stocked ? signedConfig.payload.machineProfile.doors.map(door => door.doorId) : [doorId];
    // Exercise the normal staff/restock boundary; never seed production tables directly.
    for (const seedDoorId of seedDoors) {
      const restock = await call("/api/v1/restocks", { staffSessionId: actor.sessionId, doorIds: [seedDoorId] });
      await call(`/api/v1/restocks/${restock.sessionId}/items/${seedDoorId}`, { staffSessionId: actor.sessionId, outcome: "FILLED", productFitConfirmed: true, notes: "Synthetic preview product-fit confirmation" });
      await call(`/api/v1/restocks/${restock.sessionId}/finalize`, { staffSessionId: actor.sessionId, servicedDoorsClosed: true });
    }
    await call("/api/v1/staff/safe-exit", { staffSessionId: actor.sessionId, servicedDoorsClosed: true });
    const stockedState = await call("/api/v1/state");
    assert.equal(stockedState.doors.filter(door => door.state === "AVAILABLE").length, seedDoors.length);
    assert.equal(stockedState.serviceLocked, false);
    assert.equal(stockedState.adapterMode, stripeTest ? "OFFICIAL_TEST" : "MOCK");
    if (smoke) {
    await call("/api/v1/cart/select", { doorId, productId: "sports-25", selected: true });
    const checkout = await call("/api/v1/checkout", { idempotencyKey: randomUUID(), mode: "CERTIFICATION", configVersion: 1, doorIds: [doorId] });
    const saleId = checkout.activeSale.saleId;
    await call(`/api/v1/sales/${saleId}/payment`, { idempotencyKey: randomUUID() });
    await runtime.tickLocal();
    const initialCommands = store.all("SELECT door_id,attempt,state FROM command_intent WHERE sale_id=? ORDER BY attempt", saleId);
    assert.deepEqual(initialCommands.map(({door_id, attempt, state}) => ({door_id, attempt, state})), [{door_id: doorId, attempt: 1, state: "ACCEPTED"}]);
    await call(`/api/v1/sales/${saleId}/open-doors`, { idempotencyKey: randomUUID() });
    const retryCommands = store.all("SELECT door_id,attempt,state FROM command_intent WHERE sale_id=? ORDER BY attempt", saleId);
    assert.deepEqual(retryCommands.map(({door_id, attempt, state}) => ({door_id, attempt, state})), [{door_id: doorId, attempt: 1, state: "ACCEPTED"}, {door_id: doorId, attempt: 2, state: "ACCEPTED"}]);
    assert.equal(controller.maxObservedConcurrency(), 1);
    await call(`/api/v1/sales/${saleId}/done`, {});
    await runtime.synchronize();
    console.log(JSON.stringify({ ok: true, sourceIdentity, syntheticDoors: count, publicHttpRestockCheckoutPaymentRetry: true, exactSelectedDoorOnly: true, initialUnlockCommands: initialCommands.length, retryUnlockCommands: retryCommands.length - initialCommands.length, maxConcurrentCommands: controller.maxObservedConcurrency(), eventCount: events.size, realNetworkHardwarePayment: false }));
    await close();
    }
  }
  if (!smoke) {
    if (stripeTest) {
      const presented = new Set(); let checkingCard = false;
      cardPump = setInterval(() => {
        if (checkingCard || closing) return;
        checkingCard = true;
        cardPumpTask = (async () => {
          const pending = store.all("SELECT sale_id,provider_session_id FROM sale WHERE provider_session_id IS NOT NULL AND payment_state IN ('REQUESTED','UNKNOWN','RECONCILIATION_REQUIRED') ORDER BY created_at");
          for (const row of pending) {
            if (closing) break;
            const paymentIntentId = String(row.provider_session_id);
            if (presented.has(paymentIntentId)) continue;
            const reader = await stripeApi("GET", `/v1/terminal/readers/${stripeReaderId}`);
            if (reader.id !== stripeReaderId || reader.livemode !== false || reader.location !== stripeLocationId) throw new Error("STRIPE_TEST_READER_BINDING_CHANGED");
            if (reader.action?.status !== "in_progress" || reader.action?.process_payment_intent?.payment_intent !== paymentIntentId) continue;
            if (closing) break;
            // A lost helper response is ambiguous. Never automatically present a second card.
            presented.add(paymentIntentId);
            await stripeApi("POST", `/v1/test_helpers/terminal/readers/${stripeReaderId}/present_payment_method`, { type: "card_present", "card_present[number]": "4242424242424242" });
            console.log(JSON.stringify({ phase: "stripe-test-card-presented", saleId: row.sale_id, paymentIntentId }));
          }
        })().catch((error) => {
          console.error(JSON.stringify({ phase: "stripe-test-card-presentment-needs-review", code: /^[A-Z0-9_]+$/.test(String(error?.message)) ? error.message : "UNKNOWN" }));
        }).finally(() => { checkingCard = false; });
      }, 500);
    }
    runtime.start();
    console.log(JSON.stringify({ sourceIdentity, purpose: stripeTest ? "DISPOSABLE_STRIPE_TEST_TOUCHSCREEN_BENCH" : "DISPOSABLE_SIMULATION_ONLY", machineId }));
    console.log(`Synthetic ${count}-door Vault simulator: ${origin}${stripeTest ? "/?experience=portrait" : cinematic ? "/?experience=cinematic" : ""}\n${stocked ? "All doors stocked with sample products. Ready to shop." : "Use the ten-tap staff corner to restock, then safe exit and shop."}\nTest staff: simulator-tech / PIN 123456.\n${stripeTest ? "Touchscreen checkout uses Stripe Test mode and a simulated reader; a test card is presented automatically. Doors and cloud responses remain simulated." : "All payments, doors, dimensions and cloud responses are simulated."} Press Ctrl+C to stop and remove this disposable session.`);
    process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
  }
} catch (error) { await close(); throw error; }
