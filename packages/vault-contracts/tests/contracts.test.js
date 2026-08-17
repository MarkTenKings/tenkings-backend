const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const vault = require("../dist");

test("canonical map contains exactly 150 unique, ordered doors", () => {
  assert.equal(vault.VAULT_DOOR_MAP.length, 150);
  assert.equal(new Set(vault.VAULT_DOOR_MAP.map((door) => door.doorId)).size, 150);
  assert.deepEqual(vault.VAULT_DOOR_MAP.slice(0, 7).map((door) => door.doorId), ["X-01", "K-01", "I-01", "N-01", "G-01", "S-01", "X-02"]);
  assert.equal(vault.VAULT_DOOR_MAP.at(-1).doorId, "S-25");
  assert.throws(() => vault.parseDoorId("X-26"));
  assert.equal(vault.parseDoorId("G-25").logicalChannel, 149);
});

test("manual tax input is exact basis points and subtotal tax rounds half up", () => {
  assert.equal(vault.parseTaxPercentageToBasisPoints("8.25"), 825);
  assert.equal(vault.parseTaxPercentageToBasisPoints("7.5"), 750);
  assert.equal(vault.calculateTaxCents(2500, 825), 206);
  assert.equal(vault.calculateTaxCents(10000, 825), 825);
  assert.throws(() => vault.parseTaxPercentageToBasisPoints("8.255"));
});

test("role matrix reserves finance and enrollment for Admin", () => {
  assert.equal(vault.roleMay("RESTOCKER", "RESTOCK_RUN"), true);
  assert.equal(vault.roleMay("RESTOCKER", "DOOR_TEST"), false);
  assert.equal(vault.roleMay("TECHNICIAN", "CERTIFICATION_APPROVE"), true);
  assert.equal(vault.roleMay("TECHNICIAN", "FINANCIAL_RESOLVE"), false);
  assert.equal(vault.roleMay("ADMIN", "ENROLLMENT_MANAGE"), true);
});

test("config digest and Ed25519 verification use canonical payload", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const payload = {
    schemaVersion: 1, version: 1, machineId: crypto.randomUUID(), timezone: "America/Los_Angeles",
    city: "Los Angeles", state: "CA", taxRateBasisPoints: 825,
    taxCalculationVersion: vault.VAULT_TAX_CALCULATION_VERSION,
    products: [{ id: "sports-25", name: "Sports Mystery Pack", photoUrl: "https://example.test/sports.jpg", description: "Mystery sports cards", priceCents: 2500, category: "SPORTS", taxClass: "GENERAL", active: true }],
    doorMapping: vault.SIMULATOR_DOOR_MAPPING,
    assignments: Object.fromEntries(vault.VAULT_DOOR_MAP.map(({ doorId }) => [doorId, "sports-25"])),
    support: { pageUrl: "https://support.example.test", email: "help@example.test", textNumber: "+15555550100", phoneNumber: "+15555550101", hours: "Daily 9am–5pm PT" },
    minimumAppVersion: "0.1.0", cloudFreshnessMs: 120000, retrievalSeconds: 30, retryExtensionSeconds: 30,
    createdAt: "2026-08-16T00:00:00.000Z", expiresAt: "2026-09-16T00:00:00.000Z",
  };
  const canonical = vault.canonicalJson(payload);
  const config = { payload, digest: vault.configDigest(payload), keyId: "test-key", algorithm: "Ed25519", signature: crypto.sign(null, Buffer.from(canonical), privateKey).toString("base64") };
  assert.equal(vault.verifySignedConfig(config, publicKey.export({ type: "spki", format: "pem" })), true);
  config.payload.city = "Changed";
  assert.equal(vault.verifySignedConfig(config, publicKey.export({ type: "spki", format: "pem" })), false);
});

test("redaction removes credentials, verifiers, cookies, sessions and bank-number-like fields", () => {
  const input = {
    ok: 1,
    accountStatus: "active",
    companyName: "Ten Kings",
    nested: {
      bearerToken: "bearer-value",
      cvv: "123",
      verifierHash: "derived-verifier",
      pin_verifier: "pin-verifier",
      cookie: "vault_session=secret",
      setCookie: "vault_session=secret; HttpOnly",
      providerSessionId: "provider-session-secret",
      session_identifier: "local-session-secret",
      restockSessionId: "00000000-0000-4000-8000-000000000030",
      certificationSessionId: "00000000-0000-4000-8000-000000000031",
      bankAccount: "000123456789",
      accountNumberLast4: "6789",
      routing_number: "110000000",
      iban: "GB82WEST12345698765432",
      cardNumber: "4111111111111111",
      cardholderName: "PRIVATE CUSTOMER",
    },
  };
  assert.deepEqual(vault.redactVaultValue(input), {
    ok: 1,
    accountStatus: "active",
    companyName: "Ten Kings",
    nested: {
      bearerToken: "[REDACTED]",
      cvv: "[REDACTED]",
      verifierHash: "[REDACTED]",
      pin_verifier: "[REDACTED]",
      cookie: "[REDACTED]",
      setCookie: "[REDACTED]",
      providerSessionId: "[REDACTED]",
      session_identifier: "[REDACTED]",
      restockSessionId: "00000000-0000-4000-8000-000000000030",
      certificationSessionId: "00000000-0000-4000-8000-000000000031",
      bankAccount: "[REDACTED]",
      accountNumberLast4: "[REDACTED]",
      routing_number: "[REDACTED]",
      iban: "[REDACTED]",
      cardNumber: "[REDACTED]",
      cardholderName: "[REDACTED]",
    },
  });
  assert.equal(input.nested.verifierHash, "derived-verifier");
});

test("redaction terminates on cycles/depth and never serializes opaque object values", () => {
  const circular = { label: "safe" };
  circular.self = circular;
  circular.items = [circular, { sessionId: "nested-secret" }];
  const redactedCircular = vault.redactVaultValue(circular);
  assert.equal(redactedCircular.label, "safe");
  assert.equal(redactedCircular.self, "[REDACTED]");
  assert.deepEqual(redactedCircular.items, ["[REDACTED]", { sessionId: "[REDACTED]" }]);

  const deep = { level: 0 };
  let cursor = deep;
  for (let level = 1; level <= 20; level += 1) {
    cursor.next = { level, value: level === 20 ? "must-not-escape" : "safe" };
    cursor = cursor.next;
  }
  const serialized = JSON.stringify(vault.redactVaultValue(deep));
  assert.doesNotMatch(serialized, /must-not-escape/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.deepEqual(vault.redactVaultValue({ opaque: new Map([["secret", "must-not-escape"]]), date: new Date(0), callback: () => "must-not-escape" }), {
    opaque: "[REDACTED]",
    date: "[REDACTED]",
    callback: "[REDACTED]",
  });
});

test("certification scheduler deterministically selects the least-tested door", () => {
  assert.equal(vault.nextUnderTestedDoor({ "X-01": 2, "K-01": 1 }, ["X-01", "K-01", "I-01"]), "I-01");
  assert.equal(vault.mayApproveCertification("RESTOCKER"), false);
  assert.equal(vault.mayApproveCertification("TECHNICIAN"), true);
});
