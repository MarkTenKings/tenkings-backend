const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { createRig, makeDoorAvailable, vault } = require("./helpers");

async function availablePort() {
  const server = net.createServer(); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port;
  await new Promise((resolve) => server.close(resolve)); return port;
}

test("loopback HTTP enforces origin, session, contract/content and optimistic state controls", async () => {
  const rig = await createRig(); await rig.machine.initialize(); makeDoorAvailable(rig); const port = await availablePort(); const origin = `http://127.0.0.1:${port}`;
  const service = new vault.VaultHttpService(rig.machine, rig.operations, { origin, host: "127.0.0.1", port, adapterCallbackToken: "adapter-secret-32-bytes-minimum-value", clock: rig.clock });
  await service.listen();
  const apiHeaders = { "X-Vault-Contract-Version": "1" };
  let response = await fetch(`${origin}/api/v1/state`, { headers: apiHeaders }); assert.equal(response.status, 401);
  response = await fetch(`${origin}/api/v1/session/bootstrap`, { method: "POST", headers: { ...apiHeaders, Origin: "http://evil.test", "Content-Type": "application/json" }, body: "{}" }); assert.equal(response.status, 403);
  response = await fetch(`${origin}/api/v1/session/bootstrap`, { method: "POST", headers: { ...apiHeaders, Origin: origin, "Content-Type": "application/json" }, body: "{}" }); assert.equal(response.status, 200);
  const bootstrap = await response.json(); assert.equal(Object.hasOwn(bootstrap.data, "token"), false); const cookie = response.headers.get("set-cookie").split(";")[0]; assert.match(response.headers.get("set-cookie"), /HttpOnly.*SameSite=Strict/i);
  response = await fetch(`${origin}/api/v1/state`, { headers: { ...apiHeaders, Cookie: cookie } }); let stateEnvelope = await response.json(); assert.equal(response.status, 200); assert.equal(stateEnvelope.data.doors.length, 150); assert.equal(stateEnvelope.data.city, "Los Angeles"); assert.equal(stateEnvelope.data.providerLimits.maxItems, 25); assert.deepEqual(stateEnvelope.data.buildIdentity, { sourceCommit: "test-source-commit", appVersion: "0.1.0" });
  rig.clock.advance(45_000);
  response = await fetch(`${origin}/api/v1/session/activity`, { method: "POST", headers: { ...apiHeaders, Cookie: cookie, Origin: origin, "Content-Type": "application/json", "If-Match": String(stateEnvelope.data.stateVersion) }, body: "{}" }); stateEnvelope = await response.json(); assert.equal(response.status, 200); assert.equal(stateEnvelope.data.idleSecondsRemaining, 60);
  response = await fetch(`${origin}/api/v1/health`, { headers: { ...apiHeaders, Cookie: cookie } }); const health = await response.json(); assert.equal(health.data.buildIdentity.sourceCommit, "test-source-commit"); assert.equal(health.data.localSchemaVersion, 1);
  response = await fetch(`${origin}/api/v1/cart/select`, { method: "POST", headers: { ...apiHeaders, Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ doorId: "X-01", productId: "sports-25", selected: true }) }); assert.equal(response.status, 428);
  response = await fetch(`${origin}/api/v1/cart/select`, { method: "POST", headers: { ...apiHeaders, Cookie: cookie, Origin: origin, "Content-Type": "application/json", "If-Match": String(stateEnvelope.data.stateVersion) }, body: JSON.stringify({ doorId: "X-01", productId: "sports-25", selected: true }) });
  const selected = await response.json(); assert.equal(response.status, 200); assert.equal(selected.data.cart[0].doorId, "X-01"); assert.equal(selected.data.cart[0].productName, "Sports Mystery Pack");
  response = await fetch(`${origin}/api/v1/cart/pick`, { method: "POST", headers: { ...apiHeaders, Cookie: cookie, Origin: origin, "If-Match": String(selected.data.stateVersion) }, body: "{}" }); assert.equal(response.status, 415);
  response = await fetch(`${origin}/api/v1/internal/provider-callback`, { method: "POST", headers: { ...apiHeaders, Origin: origin, "Content-Type": "application/json", "X-Vault-Adapter-Token": "wrong" }, body: "{}" }); assert.equal(response.status, 401);
  const handshake = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => socket.write([
      "GET /api/v1/events HTTP/1.1", `Host: 127.0.0.1:${port}`, "Upgrade: websocket", "Connection: Upgrade",
      `Origin: ${origin}`, `Cookie: ${cookie}`, "Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: AAECAwQFBgcICQoLDA0ODw==", "Sec-WebSocket-Protocol: vault-contract-v1", "", "",
    ].join("\r\n")));
    let data = ""; socket.on("data", (chunk) => { data += chunk.toString("latin1"); if (data.includes("\r\n\r\n")) { socket.destroy(); resolve(data); } }); socket.on("error", reject);
  });
  assert.match(handshake, /^HTTP\/1\.1 101/); assert.match(handshake, /Sec-WebSocket-Protocol: vault-contract-v1/i);
  await service.close(); rig.store.close();
});

test("service constructor rejects any non-loopback bind", async () => {
  const rig = await createRig(); assert.throws(() => new vault.VaultHttpService(rig.machine, rig.operations, { origin: "http://0.0.0.0:1", host: "0.0.0.0", adapterCallbackToken: "x", clock: rig.clock }), /loopback/i); rig.store.close();
});

test("support bundle is metadata-only, redacts logs, hashes every member and excludes the database", async () => {
  const rig = await createRig(); const root = fs.mkdtempSync(path.join(os.tmpdir(), "tk-support-test-")); const logPath = path.join(root, "vault.log");
  fs.writeFileSync(logPath, JSON.stringify({ event: "TEST", pin: "123456", bearerToken: "secret", ok: 1 }) + "\n");
  const output = path.join(root, "bundle"); const result = vault.createSupportBundleDirectory(rig.store, output, [logPath]); const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.files.length, 2); assert.equal(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true); assert.equal(result.files.some((file) => file.endsWith(".sqlite")), false);
  const redacted = fs.readFileSync(path.join(output, "redacted-vault.log"), "utf8"); assert.equal(redacted.includes("123456"), false); assert.equal(redacted.includes("secret"), false);
  rig.store.close(); fs.rmSync(root, { recursive: true, force: true });
});

test("Windows appliance artifacts include install, service, verified update, rollback and redacted support collection", () => {
  const root = path.resolve(__dirname, "../windows"); const expected = ["vault-machine-service.xml", "install.ps1", "update.ps1", "rollback.ps1", "collect-support-bundle.ps1"];
  for (const file of expected) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  assert.match(fs.readFileSync(path.join(root, "update.ps1"), "utf8"), /Get-FileHash[\s\S]*SHA256/); assert.match(fs.readFileSync(path.join(root, "rollback.ps1"), "utf8"), /previous/);
  assert.match(fs.readFileSync(path.join(root, "collect-support-bundle.ps1"), "utf8"), /SQLite database/); assert.doesNotMatch(fs.readFileSync(path.join(root, "vault-machine-service.xml"), "utf8"), /Nayax|COM\d|serial/i);
});
