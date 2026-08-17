const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const contracts = require("../../vault-contracts/dist");
const vault = require("../dist");

class FakeClock {
  constructor(value = "2026-08-16T12:00:00.000Z") { this.value = new Date(value); this.mono = 1_000; }
  now() { return new Date(this.value); }
  monotonicMs() { return this.mono; }
  advance(ms) { this.value = new Date(this.value.getTime() + ms); this.mono += ms; }
}

function makeConfig(machineId, version, privateKey, keyId = "test-config-key", overrides = {}) {
  const product = { id: "sports-25", name: "Sports Mystery Pack", photoUrl: "https://example.test/sports.jpg", description: "Mystery sports cards", priceCents: 2500, category: "SPORTS", taxClass: "GENERAL", active: true };
  const payload = {
    schemaVersion: 1, version, machineId, timezone: "America/Los_Angeles", city: "Los Angeles", state: "CA", taxRateBasisPoints: 825,
    taxCalculationVersion: contracts.VAULT_TAX_CALCULATION_VERSION, products: [product], doorMapping: contracts.SIMULATOR_DOOR_MAPPING,
    assignments: Object.fromEntries(contracts.VAULT_DOOR_MAP.map(({ doorId }) => [doorId, product.id])),
    support: { pageUrl: "https://support.example.test/vault", email: "help@example.test", textNumber: "+15555550100", phoneNumber: "+15555550101", hours: "Daily 9am-5pm PT" },
    minimumAppVersion: "0.1.0", cloudFreshnessMs: 120000, retrievalSeconds: 30, retryExtensionSeconds: 30,
    createdAt: "2026-08-16T00:00:00.000Z", expiresAt: "2027-08-16T00:00:00.000Z", ...overrides,
  };
  const canonical = contracts.canonicalJson(payload);
  return { payload, digest: contracts.configDigest(payload), keyId, algorithm: "Ed25519", signature: crypto.sign(null, Buffer.from(canonical), privateKey).toString("base64") };
}

async function createRig(options = {}) {
  const machineId = options.machineId ?? crypto.randomUUID(); const clock = options.clock ?? new FakeClock();
  const pair = options.keyPair ?? crypto.generateKeyPairSync("ed25519");
  const databasePath = options.databasePath ?? ":memory:";
  const store = new vault.VaultStore(databasePath, { machineId, appVersion: "0.1.0", sourceCommit: options.sourceCommit ?? "test-source-commit", acquireProcessLock: options.acquireProcessLock ?? false });
  const payment = options.payment ?? new vault.DeterministicNayaxMock();
  const controller = options.controller ?? new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]);
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
  const machine = new vault.VaultMachine(store, payment, controller, { pinnedConfigKeys: { "test-config-key": publicPem }, appVersion: "0.1.0", clock });
  if (options.configure !== false) {
    machine.stageConfig(makeConfig(machineId, options.configVersion ?? 1, pair.privateKey));
    const activated = machine.activatePendingConfig();
    if (!activated.activated) throw new Error(`config activation failed ${JSON.stringify(activated)}`);
    machine.markCloudContact();
  }
  return { machineId, clock, keyPair: pair, store, payment, controller, machine, operations: new vault.VaultOperationsService(machine, clock), contracts, vault };
}

function makeDoorAvailable(rig, doorIds = ["X-01"], productId = "sports-25") {
  rig.store.transaction(() => {
    for (const doorId of doorIds) rig.store.run(`UPDATE door SET state='AVAILABLE',product_id=?,planned_product_id=?,owning_sale_id=NULL,owning_restock_id=NULL WHERE door_id=?`, productId, productId, doorId);
  });
}

function grant(rig, role, pin = "123456", userId = `${role.toLowerCase()}-user`) {
  const input = {
    grantId: crypto.randomUUID(), userId, machineId: rig.machineId, role, verifierVersion: 1,
    verifier: vault.createScryptPinVerifier(pin), hashAlgorithm: "scrypt", hashParameters: { N: 16384, r: 8, p: 1 },
    validFrom: "2026-08-16T00:00:00.000Z", expiresAt: "2027-08-16T00:00:00.000Z", revokedAt: null,
  };
  rig.machine.staff.importGrant(input);
  return rig.machine.staff.authenticate(userId, pin);
}

function tempDatabase() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tk-vault-test-")); return { directory, path: path.join(directory, "vault.sqlite") }; }
function closeAndRemove(rig, directory) { try { rig.store.close(); } finally { if (directory) fs.rmSync(directory, { recursive: true, force: true }); } }

module.exports = { FakeClock, makeConfig, createRig, makeDoorAvailable, grant, tempDatabase, closeAndRemove, crypto, contracts, vault };
