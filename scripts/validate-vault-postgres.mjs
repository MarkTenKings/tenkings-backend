import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// Refuse before importing any database-backed application code.
assert.equal(process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION, "1", "Disposable harness acknowledgment required");
assert.equal(process.versions.node.split(".")[0], "20", "Node 20 required");
const target = new URL(process.env.DATABASE_URL ?? "invalid:");
assert.ok(["postgresql:", "postgres:"].includes(target.protocol));
assert.equal(target.hostname, "127.0.0.1");
assert.equal(decodeURIComponent(target.username), "tenkings_nfc_validation");
assert.equal(decodeURIComponent(target.pathname.slice(1)), "tenkings_ai_grader_nfc_validation");

const require = createRequire(import.meta.url);
const { prisma, hashVaultSecret } = require("../packages/database");
const { createRig, makeConfig, contracts, vault } = require("../packages/vault-machine/tests/helpers.js");
const { startVaultNextTestServer } = await import("./vault-next-test-server.mjs");
const { makeSyntheticConfig, makeSyntheticProfile } = require("../packages/vault-contracts/tests/profile-fixtures.js");
const profileArgument = process.argv.find((argument) => argument.startsWith("--profile-doors="));
const profileDoors = profileArgument ? Number(profileArgument.split("=")[1]) : null;
assert.ok(profileDoors === null || [72, 125].includes(profileDoors));
const rig = await createRig({ configure: false, ...(profileDoors ? { controller: new vault.DeterministicControllerSimulator(makeSyntheticProfile(profileDoors).doorMapping) } : {}) });
let publicServer;
const credential = `vault_${randomBytes(32).toString("base64url")}`;
let assertions = 0;
const check = (value, expected, label) => { assert.deepEqual(value, expected, label); assertions += 1; };

async function route(action, body, { machineId = rig.machineId, secret = credential, method = body === undefined ? "GET" : "POST", version = "1", query = {}, rawBody, contentType = "application/json" } = {}) {
  const parameters = new URLSearchParams(query);
  const response = await fetch(`${publicServer.url}/api/vault/v1/machines/${machineId}/${action}${parameters.size ? `?${parameters}` : ""}`, {
    method, headers: { authorization: `VaultMachine ${secret}`, "X-Vault-Contract-Version": version, "Content-Type": contentType },
    ...(method === "GET" ? {} : { body: rawBody ?? JSON.stringify(body ?? {}) }), signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: response.status === 304 ? null : await response.json(), headers: Object.fromEntries(response.headers) };
}

try {
  publicServer = await startVaultNextTestServer(process.env.DATABASE_URL);
  // Every run owns a new unique machine in the enclosing disposable database.
  check(await prisma.vaultMachine.count({ where: { id: rig.machineId } }), 0, "Vault fixture machine must not exist");
  const config = profileDoors ? makeSyntheticConfig(rig.machineId, 1, rig.keyPair.privateKey, profileDoors) : makeConfig(rig.machineId, 1, rig.keyPair.privateKey);
  config.keyId = "test-config-key";
  const testDoorId = contracts.configDoorIds(config.payload)[0];
  const payload = config.payload;
  await prisma.vaultMachine.create({ data: {
    id: rig.machineId, slug: `disposable-${rig.machineId}`, serialNumber: `disposable-${rig.machineId}`, displayName: "DISPOSABLE VAULT VALIDATION",
    status: "ACTIVE", timezone: payload.timezone, city: payload.city, state: payload.state, taxRateBasisPoints: payload.taxRateBasisPoints,
    currentCredentialVersion: 1,
  } });
  for (const product of payload.products) if (!await prisma.vaultProduct.findUnique({ where: { id: product.id } })) await prisma.vaultProduct.create({ data: {
    ...product, slug: `disposable-${product.id}`, createdByAdminId: "disposable-only-admin",
  } });
  await prisma.vaultDoor.createMany({ data: payload.doorMapping.map((door) => ({
    machineId: rig.machineId, doorId: door.doorId, controllerChannel: door.controllerChannel, controllerEndpointId: door.controllerEndpointId ?? "legacy",
    plannedProductId: payload.assignments[door.doorId], state: "EMPTY",
  })) });
  const storedConfig = await prisma.vaultConfigVersion.create({ data: {
    machineId: rig.machineId, version: 1, schemaVersion: payload.schemaVersion, status: "PUBLISHED", canonicalPayload: payload, digest: config.digest,
    signingKeyId: config.keyId, signingAlgorithm: config.algorithm, detachedSignature: config.signature,
    minimumAppVersion: payload.minimumAppVersion, createdByAdminId: "disposable-only-admin", publishedByAdminId: "disposable-only-admin",
    publishedAt: new Date(payload.createdAt), expiresAt: new Date(payload.expiresAt),
  } });
  await prisma.vaultMachine.update({ where: { id: rig.machineId }, data: { pendingConfigId: storedConfig.id } });
  const credentialRow = await prisma.vaultMachineCredential.create({ data: {
    machineId: rig.machineId, version: 1, credentialHash: hashVaultSecret(credential), status: "ACTIVE", activatedAt: new Date(),
  } });
  const staffGrant = {
    grantId: randomUUID(), userId: "disposable-technician", machineId: rig.machineId, role: "TECHNICIAN", grantVersion: 1, verifierVersion: 1,
    verifier: vault.createScryptPinVerifier("123456"), hashAlgorithm: "scrypt", hashParameters: { N: 16384, r: 8, p: 1 },
    validFrom: payload.createdAt, expiresAt: payload.expiresAt, revokedAt: null,
  };
  await prisma.vaultStaffMachineAccess.create({ data: {
    grantId: staffGrant.grantId, userId: staffGrant.userId, machineId: rig.machineId, role: staffGrant.role, grantVersion: 1, verifierVersion: 1,
    verifierHash: staffGrant.verifier, verifierAlgorithm: "scrypt", verifierParameters: staffGrant.hashParameters,
    validFrom: new Date(staffGrant.validFrom), expiresAt: new Date(staffGrant.expiresAt), createdByAdminId: "disposable-only-admin",
  } });
  const pulledConfig = await route("config");
  check(pulledConfig.status, 200, "Authenticated public config route");
  check(pulledConfig.body.config, config, "Published signed config survives real PostgreSQL and Next transport unchanged");
  check((await route("config", undefined, { query: { digest: config.digest } })).status, 304, "Exact config digest permits cache response");
  check((await route("config", undefined, { query: { version: "1" } })).status, 200, "Version alone cannot authorize a config cache hit");
  const pulled = await route("staff-grants:pull", undefined, { query: { afterGrantVersion: "0" } });
  check(pulled.status, 200, "Authenticated staff route");
  check(pulled.body.grants, [staffGrant], "Exact grant response and cursor semantics");
  check(pulled.body.latestGrantVersion, 1, "Monotonic grant cursor");
  check((await route("staff-grants:pull", undefined, { machineId: randomUUID() })).status, 403, "Credential is machine-path-bound");
  check((await route("events:batch", { contractVersion: 1, events: [] }, { version: "2" })).status, 426, "Version rejected before database effects");
  check((await route("events:batch", undefined)).status, 405, "Public event method enforcement");
  check((await route("events:batch", {}, { rawBody: "{bad" })).status, 400, "Actual public route rejects malformed JSON");
  check((await route("events:batch", {}, { contentType: "application/jsonp" })).status, 415, "Exact JSON media type is enforced");
  check((await route("staff-grants:pull", undefined, { query: { afterGrantVersion: "-1" } })).status, 400, "Authenticated staff cursor validation");
  check((await route("staff-grants:pull", undefined, { secret: `vault_${"z".repeat(43)}` })).status, 403, "Unregistered machine credential cannot obtain verifiers");
  check((await route("events:batch", { contractVersion: 1, events: [{ eventId: randomUUID(), schemaVersion: 1, machineId: randomUUID(), sequence: 1, type: "PUBLIC_ACTIVITY_RECORDED", mode: "CERTIFICATION", occurredAt: rig.clock.now().toISOString(), payload: { observedAt: rig.clock.now().toISOString() } }] })).status, 403, "Event machine identity must match authenticated public path");

  await rig.machine.initialize();
  rig.machine.stageConfig(pulledConfig.body.config); rig.machine.activatePendingConfig(); rig.machine.markCloudContact();
  const initialState = await rig.machine.publicState();
  const heartbeat = await route("heartbeat", {
    contractVersion: 1, appVersion: "0.1.0", sourceCommit: "a".repeat(40), localSchemaVersion: Number(rig.store.one("SELECT schema_version FROM machine_meta WHERE singleton=1").schema_version),
    configVersion: 1, configDigest: config.digest, health: initialState.health, readinessReasons: initialState.readinessReasons,
    availableDoorCount: 0, outboxPendingCount: rig.store.one("SELECT count(*) AS count FROM outbox").count, serviceLocked: initialState.serviceLocked, observedAt: rig.clock.now().toISOString(),
  });
  check(heartbeat.status, 200, "Actual heartbeat activates only the exact published pending config");
  check(heartbeat.body.machine.id, rig.machineId, "Heartbeat response is bound to the calling machine");
  const activatedMachine = await prisma.vaultMachine.findUnique({ where: { id: rig.machineId } });
  check([activatedMachine.activeConfigId, activatedMachine.pendingConfigId], [storedConfig.id, null], "Heartbeat transaction persists config activation");
  rig.machine.staff.importGrant(pulled.body.grants[0]);
  const actor = rig.machine.staff.authenticate(staffGrant.userId, "123456");
  const restock = await rig.operations.startOrResumeRestock(actor.sessionId, [testDoorId]);
  rig.operations.recordRestockOutcome(actor.sessionId, restock.sessionId, testDoorId, "FILLED", "Disposable simulated restock", true);
  rig.operations.finalizeRestock(actor.sessionId, restock.sessionId, true);
  rig.machine.staff.safeExit(actor.sessionId, true);
  rig.machine.selectCartDoor(testDoorId, "sports-25", true);
  const sale = (await rig.machine.checkout({ idempotencyKey: randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: [testDoorId] })).sale;
  await rig.machine.startPayment(sale.saleId, randomUUID()); await rig.machine.advancePayments();
  await rig.machine.openPaidDoorsAgain(sale.saleId, randomUUID());
  rig.machine.markPresentationDone(sale.saleId);
  const envelopes = rig.store.all("SELECT payload_json FROM outbox ORDER BY sequence").map((row) => JSON.parse(row.payload_json));
  assert.ok(envelopes.length < 250);
  const batch = { contractVersion: 1, events: envelopes };
  // Concurrent retries traverse real per-machine PostgreSQL locks and projections.
  const delivered = await Promise.all([route("events:batch", batch), route("events:batch", batch)]);
  for (const result of delivered) {
    const firstRejected = result.body.rejected?.[0];
    const rejectedEvent = envelopes.find((entry) => entry.eventId === firstRejected?.eventId);
    check(result.status, 200, `Machine-generated event projection failed: ${JSON.stringify({ firstRejected, rejectedEvent })}`);
    check(result.body.acknowledgedEventIds, envelopes.map((event) => event.eventId), "Duplicate delivery acknowledges the same contiguous facts");
  }
  check(await prisma.vaultMachineEvent.count({ where: { machineId: rig.machineId } }), envelopes.length, "No duplicate facts");
  check(await prisma.vaultSale.count({ where: { machineId: rig.machineId } }), 1, "No duplicate sale");
  const projected = await prisma.vaultSale.findUnique({ where: { id: sale.saleId }, include: { items: true } });
  check(projected.mode, "CERTIFICATION", "Mock mode cannot become production revenue");
  check(projected.paymentState, "SETTLED", "Durable mock settlement projected");
  check(projected.items[0].mappingVersionSnapshot, "1", "Mapping version must survive redaction");
  check(projected.items[0].initialCommandState, "ACCEPTED", "Initial paid command projection");
  check(projected.items[0].retryCommandState, "ACCEPTED", "Exactly one group retry projection");
  assert.ok(projected.groupRetryConsumedAt && projected.customerDoneAt && projected.authorizationObservedAt && projected.settlementObservedAt);
  check(await prisma.vaultDoor.count({ where: { machineId: rig.machineId, state: { not: "EMPTY" } } }), 0, "Simulator facts cannot mutate production door inventory");
  check((await prisma.vaultRestockSession.findUnique({ where: { id: restock.sessionId } })).filledCount, 1, "Canonical restock projection");
  assert.ok(await prisma.vaultMachineEvent.findFirst({ where: { machineId: rig.machineId, actor: staffGrant.userId } }));
  const last = envelopes.at(-1).sequence;
  const event = (sequence) => ({ eventId: randomUUID(), schemaVersion: 1, machineId: rig.machineId, sequence, type: "PUBLIC_ACTIVITY_RECORDED", mode: "CERTIFICATION", occurredAt: rig.clock.now().toISOString(), payload: { observedAt: rig.clock.now().toISOString() } });
  const first = event(last + 1), poison = { ...event(last + 2), payload: { observedAt: "invalid" } }, blocked = event(last + 3);
  check((await route("events:batch", { contractVersion: 1, events: [first, blocked] })).status, 400, "Within-batch noncontiguous order is rejected before projection");
  const partial = await route("events:batch", { contractVersion: 1, events: [first, poison, blocked] });
  check(partial.status, 207, "Contiguous-prefix partial response");
  check(partial.body.acknowledgedEventIds, [first.eventId], "Only the contiguous prefix commits");
  check(partial.body.rejected.map((item) => item.code), ["EVENT_PAYLOAD_INVALID", "CONTIGUOUS_PREFIX_BLOCKED"], "Invalid payload blocks all following facts");
  const gap = await route("events:batch", { contractVersion: 1, events: [blocked] });
  check(gap.status, 207, "Gap from the persisted cursor is quarantined");
  check(gap.body.rejected[0].code, "SEQUENCE_GAP", "Future event cannot overtake the rejected fact");
  const conflict = await route("events:batch", { contractVersion: 1, events: [{ ...first, payload: { observedAt: "2026-08-17T00:00:00.000Z" } }] });
  check(conflict.status, 207, "Same ID with changed payload is quarantined");
  check(conflict.body.rejected[0].code, "EVENT_ID_PAYLOAD_CONFLICT", "Conflicting event does not overwrite original");
  await prisma.vaultMachineCredential.update({ where: { id: credentialRow.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  check((await route("staff-grants:pull", undefined)).status, 403, "Revoked disposable credential rejected");
  if (profileDoors) {
    check(projected.items[0].doorLabelSnapshot, payload.machineProfile.doors[0].label, "Public route preserves the paid printed label");
    check(projected.items[0].controllerEndpointIdSnapshot, payload.doorMapping.find((entry) => entry.doorId === testDoorId).controllerEndpointId, "Public route preserves the explicit paid endpoint");
    check(projected.configVersionId, storedConfig.id, "Historical sale remains bound to its immutable profile configuration");
  }
  console.log(`VAULT_V1_REAL_POSTGRES_VALIDATION_PASS: ${assertions} assertions, ${profileDoors ?? "legacy150"} doors, canonical machine/restock/payment/retry events through public production Next HTTP, concurrent idempotency and auth/path-bound routes`);
} finally {
  rig.store.close(); await prisma.$disconnect(); await publicServer?.close();
  // Append-only fixtures are destroyed by the enclosing tmpfs container harness.
}
