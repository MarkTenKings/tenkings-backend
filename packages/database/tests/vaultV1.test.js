const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vault = require("../dist/database/src/vaultV1.js");

test("Vault secrets are hash-only and compared safely", () => {
  const secret = "vault_machine_secret_0123456789_abcdef";
  const hash = vault.hashVaultSecret(secret);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes(secret), false);
  assert.equal(vault.verifyVaultSecret(secret, hash), true);
  assert.equal(vault.verifyVaultSecret(`${secret}x`, hash), false);
  assert.throws(() => vault.hashVaultSecret("too-short"));
});

test("event batches require unique IDs and strictly increasing sequence", () => {
  vault.assertVaultEventOrder([
    { eventId: "a", sequence: 1 },
    { eventId: "b", sequence: 2 },
  ]);
  assert.throws(() => vault.assertVaultEventOrder([{ eventId: "a", sequence: 2 }, { eventId: "b", sequence: 2 }]));
  assert.throws(() => vault.assertVaultEventOrder([{ eventId: "a", sequence: 1 }, { eventId: "a", sequence: 2 }]));
  assert.throws(() => vault.assertVaultEventOrder([{ eventId: "a", sequence: 1 }, { eventId: "b", sequence: 3 }]), /contiguous/i);
  assert.deepEqual(vault.vaultAcknowledgedContiguousPrefix(
    [{ eventId: "a" }, { eventId: "b" }, { eventId: "c" }],
    new Set(["a", "c"]),
  ), ["a"]);
});

test("event payload boundary redacts secrets and rejects depth, key, numeric and byte abuse", () => {
  assert.deepEqual(vault.normalizeVaultEventPayload({ ok: "visible", pin: "123456", nested: { providerSessionId: "raw" } }), {
    ok: "visible",
    pin: "[REDACTED]",
    nested: { providerSessionId: "[REDACTED]" },
  });
  assert.throws(() => vault.normalizeVaultEventPayload({ bad: 1.25 }), /safe integers/i);
  assert.throws(() => vault.normalizeVaultEventPayload({ ["x".repeat(65)]: true }), /invalid key/i);
  assert.throws(() => vault.normalizeVaultEventPayload({ a: { b: { c: { d: { e: { f: { g: true } } } } } } }), /depth/i);
  assert.throws(() => vault.normalizeVaultEventPayload({ text: "x".repeat(4001) }), /too long/i);
  const maximumDoorSnapshot = Array.from({ length: 150 }, (_, index) => ({
    lineId: `line-${index}`,
    doorId: `X-${String((index % 25) + 1).padStart(2, "0")}`,
    productId: "sports-25",
    productName: "Sports Mystery Pack",
    photoUrl: "https://example.test/product.jpg",
    description: "A bounded immutable paid-line snapshot.",
    category: "SPORTS",
    priceCents: 2500,
    taxClass: "GENERAL",
    controllerChannel: index + 1,
    mappingVersion: "1",
  }));
  assert.equal(vault.normalizeVaultEventPayload({ items: maximumDoorSnapshot }).items.length, 150, "the key budget must admit the frozen 150-door sale cardinality");
});

test("cloud scrypt verifiers are byte-for-byte compatible with the frozen 64-byte machine format", () => {
  const salt = Buffer.alloc(16, 7);
  const result = vault.createVaultScryptPinVerifier("123456", salt);
  assert.match(result.verifier, /^scrypt\$v=1\$N=16384,r=8,p=1,l=64\$/);
  assert.deepEqual(result.parameters, { N: 16384, r: 8, p: 1, keyLength: 64 });
  assert.equal(vault.verifyVaultScryptPin("123456", result.verifier), true);
  assert.equal(vault.verifyVaultScryptPin("123455", result.verifier), false);
  assert.throws(() => vault.createVaultScryptPinVerifier("12345", salt));
});

test("event digests are canonical and detect changed payloads", () => {
  assert.equal(vault.vaultPayloadDigest({ b: 2, a: 1 }), vault.vaultPayloadDigest({ a: 1, b: 2 }));
  assert.notEqual(vault.vaultPayloadDigest({ a: 1 }), vault.vaultPayloadDigest({ a: 2 }));
});

test("production reporting excludes certification unless explicitly requested", () => {
  assert.deepEqual(vault.vaultProductionSalesFilter(), { mode: "PRODUCTION" });
  assert.deepEqual(vault.vaultProductionSalesFilter(true), {});
});

test("certification retention remains indefinite during service and ends three years after decommission", () => {
  assert.equal(vault.vaultCertificationRetainUntil(null), null);
  assert.equal(vault.vaultCertificationRetainUntil(new Date("2030-02-01T00:00:00.000Z")).toISOString(), "2033-02-01T00:00:00.000Z");
});

test("machine credentials are bound to the path machine", () => {
  vault.assertVaultMachinePathBinding("machine-a", "machine-a");
  assert.throws(() => vault.assertVaultMachinePathBinding("machine-a", "machine-b"));
});

test("Vault migration is additive, source-only, and protects append-only ledgers", () => {
  const sql = readFileSync(join(
    __dirname,
    "../prisma/migrations/20260817010000_vault_v1_cloud_domain/migration.sql",
  ), "utf8");
  assert.match(sql, /^-- SOURCE ONLY: additive Vault V1 migration\. Do not apply/m);
  assert.doesNotMatch(sql, /^\+/m);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
  assert.match(sql, /CREATE TABLE "VaultMachine"/);
  assert.match(sql, /CREATE TABLE "VaultSale"/);
  assert.match(sql, /CREATE TABLE "VaultCertificationEvidence"/);
  assert.match(sql, /CREATE TRIGGER "VaultMachineEvent_append_only"/);
  assert.match(sql, /CREATE TRIGGER "VaultAdminAuditEvent_append_only"/);
  assert.match(sql, /CREATE TRIGGER "VaultStaffMachineAccess_append_only"/);
  assert.match(sql, /"grantId" TEXT NOT NULL/);
  assert.match(sql, /VaultStaffMachineAccess_machineId_grantVersion_key/);
  assert.match(sql, /VaultDoor_owningSaleId_fkey/);
  assert.match(sql, /VaultDoor_owningRestockId_fkey/);
  assert.match(sql, /VaultProduct_price_check/);
  assert.match(sql, /VaultSale_money_check/);
  assert.match(sql, /VaultMachineEvent_payload_check/);
});
