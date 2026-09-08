const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRig, makeConfig, grant, tempDatabase, closeAndRemove, crypto, vault } = require("./helpers");

test("SQLite authority applies migrations and required durability pragmas", async () => {
  const rig = await createRig();
  assert.deepEqual(rig.store.pragmaSnapshot(), { journalMode: "memory", foreignKeys: 1, synchronous: 2, busyTimeout: 5000 });
  assert.deepEqual(rig.store.integrityCheck(), { ok: true, rows: ["ok"] });
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM door`).count, 150);
  assert.equal(rig.store.one(`SELECT MAX(version) AS version FROM schema_migration`).version, vault.LOCAL_SCHEMA_VERSION);
  rig.store.close();
});

test("one-writer service lock rejects a second process owner", () => {
  const temporary = tempDatabase(); const machineId = crypto.randomUUID();
  const first = new vault.VaultStore(temporary.path, { machineId, appVersion: "0.1.0" });
  assert.throws(() => new vault.VaultStore(temporary.path, { machineId, appVersion: "0.1.0" }), /service lock/i);
  first.close();
  const reopened = new vault.VaultStore(temporary.path, { machineId, appVersion: "0.1.0" }); reopened.close();
  fs.rmSync(temporary.directory, { recursive: true, force: true });
});

test("encrypted backup authenticates, verifies, restores, and rejects wrong key", async () => {
  const temporary = tempDatabase(); const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true });
  const key = crypto.randomBytes(32); const backupPath = path.join(temporary.directory, "vault.tkvault");
  const backup = rig.store.encryptedBackup(backupPath, key);
  assert.match(backup.ciphertextDigest, /^[a-f0-9]{64}$/); assert.notEqual(backup.ciphertextDigest, backup.plaintextDigest);
  rig.store.close(); const restoredPath = path.join(temporary.directory, "restored.sqlite");
  assert.throws(() => vault.VaultStore.restoreEncrypted(backupPath, restoredPath, crypto.randomBytes(32)), /authentication failed/i);
  vault.VaultStore.restoreEncrypted(backupPath, restoredPath, key);
  const restored = new vault.VaultStore(restoredPath, { machineId: rig.machineId, appVersion: "0.1.0", acquireProcessLock: false });
  assert.equal(restored.integrityCheck().ok, true); assert.equal(restored.one(`SELECT COUNT(*) AS count FROM door`).count, 150);
  restored.close(); fs.rmSync(temporary.directory, { recursive: true, force: true });
});

test("encrypted backup rotation remains bounded while retaining immutable metadata", async () => {
  const temporary = tempDatabase(); const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true }); const key = crypto.randomBytes(32); const output = path.join(temporary.directory, "rotation");
  rig.store.rotateEncryptedBackup(output, key, 2); rig.store.rotateEncryptedBackup(output, key, 2); rig.store.rotateEncryptedBackup(output, key, 2);
  assert.equal(fs.readdirSync(output).filter((name) => name.endsWith(".tkvault")).length, 2); assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM backup_metadata`).count, 3); assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM backup_metadata WHERE removed_at IS NOT NULL`).count, 1);
  rig.store.close(); fs.rmSync(temporary.directory, { recursive: true, force: true });
});

test("backup and restore preserve existing targets and failed backup removes plaintext staging", async () => {
  const temporary = tempDatabase(); const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true });
  try {
    const backup = path.join(temporary.directory, "review-backup.tkvault"); const key = crypto.randomBytes(32);
    rig.store.encryptedBackup(backup, key); const bytes = fs.readFileSync(backup);
    assert.throws(() => rig.store.encryptedBackup(backup, key), /exist/i);
    assert.deepEqual(fs.readFileSync(backup), bytes);
    assert.equal(fs.readdirSync(temporary.directory).some(name => /review-backup\.tkvault\..+\.sqlite$/.test(name)), false);
    assert.throws(() => vault.VaultStore.restoreEncrypted(backup, temporary.path, key), /new database path/i);
    const target = path.join(temporary.directory, "existing.sqlite"); fs.writeFileSync(target, "do not replace");
    assert.throws(() => vault.VaultStore.restoreEncrypted(backup, target, key), /new database path/i);
    assert.equal(fs.readFileSync(target, "utf8"), "do not replace");
    assert.throws(() => new vault.VaultStore(":memory:", { machineId: "not-a-machine-uuid", appVersion: "0.1.0" }), /UUID/i);
    assert.throws(() => new vault.VaultStore(":memory:", { machineId: rig.machineId, appVersion: "0.1.0", busyTimeoutMs: "0;DROP TABLE sale" }), /bounded integer/i);
  } finally { closeAndRemove(rig, temporary.directory); }
});

test("startup rejects a different machine before migration and checks foreign-key integrity", async () => {
  const temporary = tempDatabase(); const rig = await createRig({ databasePath: temporary.path, acquireProcessLock: true });
  rig.store.close();
  try {
    assert.throws(() => new vault.VaultStore(temporary.path, { machineId: crypto.randomUUID(), appVersion: '9.9.9' }), /different machine/i);
    assert.equal(fs.existsSync(`${temporary.path}.writer.lock`), false);
    const restored = new vault.VaultStore(temporary.path, { machineId: rig.machineId, appVersion: '0.1.0' });
    try {
      restored.db.exec('PRAGMA foreign_keys=OFF');
      restored.run("INSERT INTO cart_item(door_id,product_id,selected_at) VALUES('X-99','invalid','2026-08-16T00:00:00.000Z')");
      restored.db.exec('PRAGMA foreign_keys=ON');
      assert.equal(restored.integrityCheck().ok, false);
      assert.equal(restored.one('SELECT recovery_required FROM machine_meta').recovery_required, 1);
    } finally { restored.close(); }
  } finally { fs.rmSync(temporary.directory, { recursive: true, force: true }); }
});

test("signed config rejects tamper, downgrade, wrong machine and activates only at a safe boundary", async () => {
  const rig = await createRig();
  const version2 = makeConfig(rig.machineId, 2, rig.keyPair.privateKey, "test-config-key", { city: "Burbank" });
  rig.machine.stageConfig(version2); assert.equal(rig.machine.activatePendingConfig().activated, true);
  assert.equal(rig.machine.config.active().payload.city, "Burbank");
  assert.throws(() => rig.machine.stageConfig(makeConfig(rig.machineId, 1, rig.keyPair.privateKey)), /downgrade/i);
  assert.throws(() => rig.machine.stageConfig(makeConfig(crypto.randomUUID(), 3, rig.keyPair.privateKey)), /different machine/i);
  const tampered = makeConfig(rig.machineId, 3, rig.keyPair.privateKey); tampered.payload.city = "Tampered";
  assert.throws(() => rig.machine.stageConfig(tampered), /signature/i);
  rig.store.close();
});

test("cloud freshness blocks only new checkout readiness and signed config activation waits for active staff", async () => {
  const rig = await createRig(); rig.clock.advance(120001); const stale = await rig.machine.readiness(); assert.equal(stale.ready, false); assert.ok(stale.reasons.includes("CLOUD_NOT_FRESH"));
  rig.machine.markCloudContact(); const verifier = vault.createScryptPinVerifier("123456");
  rig.machine.staff.importGrant({ grantId: crypto.randomUUID(), userId: "tech", machineId: rig.machineId, role: "TECHNICIAN", verifierVersion: 1, verifier, hashAlgorithm: "scrypt", hashParameters: { N: 16384, r: 8, p: 1 }, validFrom: "2026-08-16T00:00:00.000Z", expiresAt: "2027-08-16T00:00:00.000Z", revokedAt: null });
  const session = rig.machine.staff.authenticate("tech", "123456"); rig.machine.stageConfig(makeConfig(rig.machineId, 2, rig.keyPair.privateKey));
  assert.deepEqual(rig.machine.activatePendingConfig(), { activated: false, version: 2, reasons: ["ACTIVE_STAFF_SESSION"] });
  rig.machine.staff.safeExit(session.sessionId, true); assert.equal(rig.machine.activatePendingConfig().activated, true); rig.store.close();
});

test("a signed complete controller remap activates atomically without transient unique-channel conflicts", async () => {
  const rig = await createRig(); const mapping = rig.contracts.SIMULATOR_DOOR_MAPPING.map((entry) => ({ ...entry }));
  [mapping[0].controllerChannel, mapping[1].controllerChannel] = [mapping[1].controllerChannel, mapping[0].controllerChannel];
  const pending = makeConfig(rig.machineId, 2, rig.keyPair.privateKey, "test-config-key", { doorMapping: mapping });
  rig.machine.stageConfig(pending); assert.deepEqual(rig.machine.activatePendingConfig().reasons, ["PROFILE_RECONFIGURATION_REQUIRED"]);
  const actor = grant(rig, "TECHNICIAN");
  rig.machine.activatePendingProfile(actor.sessionId, 2, pending.digest, true, true);
  assert.equal(rig.store.one(`SELECT controller_channel FROM door WHERE door_id='X-01'`).controller_channel, 2); assert.equal(rig.store.one(`SELECT controller_channel FROM door WHERE door_id='K-01'`).controller_channel, 1); rig.store.close();
});
