import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { calculateTaxCents, machineProfileDigest, type VaultConfigPayload, type VaultMachineEvent } from "@tenkings/vault-contracts";
import { activateVaultProfileProjection, assertVaultProfilePublicationEvidence, validateVaultConfigPayload, vaultConfigImpact, verifyVaultProfileEvidence } from "../lib/server/vaultV1/config";
import { normalizeTypedVaultEvent, projectVaultMachineEvent } from "../lib/server/vaultV1/events";
import { requireVaultJson, sendVaultError, VaultApiError, withVaultJsonBody } from "../lib/server/vaultV1/http";
import { evaluateVaultCertificationApproval } from "../lib/server/vaultV1/certification";
import { VaultSalesQuerySchema, vaultMachineDto } from "../lib/server/vaultV1/reporting";

const { makeSyntheticConfig } = require("../../../packages/vault-contracts/tests/profile-fixtures.js");
const { createRig, makeConfig, grant, vault } = require("../../../packages/vault-machine/tests/helpers.js");
const { privateKey } = generateKeyPairSync("ed25519");
const machineId = "00000000-0000-4000-8000-000000000001";
const saleId = "00000000-0000-4000-8000-000000000002";
const restockSessionId = "00000000-0000-4000-8000-000000000003";
function config(count = 72): Extract<VaultConfigPayload, { schemaVersion: 2 }> { return makeSyntheticConfig(machineId, 1, privateKey, count).payload; }
function event(type: string, payload: Record<string, unknown>, overrides: Partial<VaultMachineEvent> = {}) {
  return normalizeTypedVaultEvent({ eventId: randomUUID(), schemaVersion: 1, machineId, sequence: 1, type, mode: "CERTIFICATION", occurredAt: "2026-09-07T01:00:00.000Z", payload, ...overrides });
}
function errorCode(code: string) { return (error: unknown) => error instanceof VaultApiError && error.code === code; }

test("config membership, geometry, mapping impact and historical references follow varying synthetic profiles", () => {
  for (const count of [8, 72, 125]) {
    const payload = config(count);
    assert.equal(validateVaultConfigPayload(payload).summary.doorCount, count);
    assert.ok(new Set(payload.machineProfile.doors.map((door) => door.usableCompartmentMm.depth)).size > 1);
    const next = structuredClone(payload);
    next.version++;
    const first = next.doorMapping[0]!, second = next.doorMapping[1]!;
    [first.controllerChannel, second.controllerChannel] = [second.controllerChannel, first.controllerChannel];
    assert.deepEqual(vaultConfigImpact(payload, next).changedMappingDoorIds, payload.machineProfile.doors.filter((door) => [first.doorId, second.doorId].includes(door.doorId)).map((door) => door.doorId));
    assert.equal(payload.doorMapping[0]!.controllerChannel, second.controllerChannel, "previous signed mapping stays unchanged");
    const invalid = structuredClone(payload);
    invalid.assignments.outside_profile = null;
    assert.throws(() => validateVaultConfigPayload(invalid));
  }
  const impact = vaultConfigImpact(config(125), config(72));
  assert.equal((impact.retiredDoorIds as string[]).length, 53);
});

test("sale projection pins the full signed profile plus label and explicit address even for a retired door", async () => {
  const payload = config();
  const door = payload.machineProfile.doors[0]!, product = payload.products[0]!, mapping = payload.doorMapping.find((entry) => entry.doorId === door.doorId)!;
  const snapshot = { lineId: randomUUID(), doorId: door.doorId, productId: product.id, productName: product.name, photoUrl: product.photoUrl, description: product.description, category: product.category, priceCents: product.priceCents, taxClass: product.taxClass, controllerChannel: mapping.controllerChannel, controllerEndpointId: mapping.controllerEndpointId, doorLabel: door.label, profileDigest: machineProfileDigest(payload.machineProfile), mappingVersion: "1" };
  const taxCents = calculateTaxCents(product.priceCents, payload.taxRateBasisPoints);
  const sale = { saleId, supportReference: "ABC12345", configVersion: 1, configDigest: "a".repeat(64), timezone: payload.timezone, city: payload.city, state: payload.state, taxRateBasisPoints: payload.taxRateBasisPoints, taxCalculationVersion: payload.taxCalculationVersion, subtotalCents: product.priceCents, taxCents, totalCents: product.priceCents + taxCents, currency: "USD", items: [snapshot] };
  let saved: any;
  const tx: any = { vaultConfigVersion: { findUnique: async () => ({ id: "old-immutable-config", version: 1, publishedAt: new Date(), digest: sale.configDigest, canonicalPayload: payload }) }, vaultDoor: { findMany: async () => [{ id: "retained-door", doorId: door.doorId, retiredAt: new Date(), doorLabel: "New label", controllerChannel: 99 }] }, vaultSale: { create: async ({ data }: any) => { saved = data; } } };
  await projectVaultMachineEvent(tx, event("SALE_RESERVED", sale));
  assert.equal(saved.configVersionId, "old-immutable-config");
  assert.equal(saved.items.create[0].doorLabelSnapshot, door.label);
  assert.equal(saved.items.create[0].controllerEndpointIdSnapshot, mapping.controllerEndpointId);
  assert.equal(saved.items.create[0].controllerChannelSnapshot, mapping.controllerChannel);
  for (const wrong of [{ doorLabel: "invented" }, { controllerEndpointId: "unknown-board" }, { profileDigest: "f".repeat(64) }]) {
    await assert.rejects(projectVaultMachineEvent(tx, event("SALE_RESERVED", { ...sale, items: [{ ...snapshot, ...wrong }] })), errorCode("SALE_PROFILE_SNAPSHOT_MISMATCH"));
  }
});

test("profile activation blocks a stocked remap, then retires addresses before an explicit permutation", async () => {
  const payload = config(8);
  const doors = payload.doorMapping.map((entry, index) => ({ id: `record-${index}`, ...entry, state: "EMPTY", retiredAt: null, activeProductId: null, owningSaleId: null, owningRestockId: null }));
  const first = payload.doorMapping[0]!, second = payload.doorMapping[1]!;
  [first.controllerChannel, second.controllerChannel] = [second.controllerChannel, first.controllerChannel];
  const operations: string[] = [];
  const tx: any = { vaultDoor: { findMany: async () => doors, updateMany: async () => { operations.push("retire"); }, upsert: async () => { operations.push("upsert"); } } };
  doors[0]!.state = "AVAILABLE";
  await assert.rejects(activateVaultProfileProjection(tx, machineId, payload), errorCode("PROFILE_RECONCILIATION_REQUIRED"));
  assert.deepEqual(operations, []);
  doors[0]!.state = "EMPTY";
  await activateVaultProfileProjection(tx, machineId, payload);
  assert.equal(operations[0], "retire");
  assert.equal(operations.filter((value) => value === "upsert").length, 8);
});

test("higher callback sequences cannot reopen terminal payments or erase authorization timestamps", async () => {
  const authorizationObservedAt = new Date("2026-09-07T00:59:00.000Z");
  const sale: any = { id: saleId, mode: "CERTIFICATION", state: "CUSTOMER_DONE", paymentState: "SETTLED", fulfillmentState: "COMMANDS_TERMINAL", authorizationObservedAt, providerCallbackSequence: 2, customerDoneAt: new Date() };
  const writes: any[] = [];
  const tx: any = { vaultSale: { findFirst: async () => sale, updateMany: async ({ data }: any) => { writes.push(data); } } };
  const callback = (state: string) => event("PAYMENT_CALLBACK_APPLIED", { callbackId: "callback-3", sequence: 3, state, disposition: "APPLIED" }, { correlationId: saleId });
  await assert.rejects(projectVaultMachineEvent(tx, callback("AUTHORIZED")), errorCode("PAYMENT_STATE_TRANSITION_INVALID"));
  sale.paymentState = "AUTHORIZED";
  await projectVaultMachineEvent(tx, callback("AUTHORIZED"));
  assert.equal(writes[0].authorizationObservedAt, undefined);
  assert.equal(writes[0].state, undefined);
  sale.paymentState = "NOT_REQUESTED";
  sale.fulfillmentState = "NOT_COMMITTED";
  await assert.rejects(projectVaultMachineEvent(tx, callback("AUTHORIZED")), errorCode("PAYMENT_STATE_TRANSITION_INVALID"));
});

test("late legacy start-error events preserve stronger payment evidence without creating false support cases", async () => {
  let writes = 0;
  const sale: any = { id: saleId, mode: "CERTIFICATION", paymentState: "DECLINED" };
  const tx: any = { vaultSale: { findFirst: async () => sale, updateMany: async () => { writes++; } }, vaultSupportCase: { upsert: async () => { writes++; } } };
  for (const state of ["DECLINED", "CANCELLED", "AUTHORIZED", "VEND_RESULT_PENDING", "SETTLEMENT_PENDING", "SETTLED", "RECONCILIATION_REQUIRED"]) {
    sale.paymentState = state;
    await projectVaultMachineEvent(tx, event("PAYMENT_START_EFFECT_UNKNOWN", { saleId, errorClass: "Error" }, { correlationId: saleId }));
  }
  assert.equal(writes, 0);
});

test("cloud certification rejects physical evidence classes from either mocked adapter", async () => {
  const rig = await createRig();
  try {
    const actor = grant(rig, "TECHNICIAN"); const cert = await rig.operations.startCertification(actor.sessionId);
    rig.operations.recordCertificationEvidence(actor.sessionId, { evidenceId: randomUUID(), sessionId: cert.sessionId, doorId: cert.scheduledDoorId, evidenceClass: "AUTOMATED", outcome: "PASS", expectedDoorIds: [cert.scheduledDoorId], observedDoorIds: [cert.scheduledDoorId], notes: "Simulator only", artifactDigest: "b".repeat(64), observedAt: rig.clock.now().toISOString() });
    const envelope = JSON.parse(rig.store.one("SELECT payload_json FROM outbox WHERE event_id=(SELECT event_id FROM machine_event WHERE type='CERTIFICATION_EVIDENCE_RECORDED')").payload_json);
    for (const mockedIdentity of ["controllerIdentity", "nayaxFlowConfig"]) {
      const tx: any = { vaultCertificationSession: { findFirst: async () => ({ status: "ACTIVE", [mockedIdentity]: { mode: "MOCK" } }) } };
      for (const evidenceClass of ["OFFICIAL_SDK", "BENCH", "FULL_MACHINE", "FIELD"]) {
        await assert.rejects(projectVaultMachineEvent(tx, normalizeTypedVaultEvent({ ...envelope, payload: { ...envelope.payload, evidenceClass } })), errorCode("CERTIFICATION_EVIDENCE_CLASS_INVALID"));
      }
    }
  } finally { rig.store.close(); }
});

test("restock finalization proves exact terminal observations, mode and persisted outcome counts", async () => {
  const session: any = { id: restockSessionId, expectedDoorCount: 2, items: [{ state: "FILLED", commandTerminalAt: new Date() }, { state: "LEFT_EMPTY", commandTerminalAt: null }] };
  let writes = 0;
  let query: any;
  const tx: any = { vaultRestockSession: { findFirst: async (value: any) => { query = value; return session; }, updateMany: async () => { writes++; return { count: 1 }; } } };
  const finalize = (filled: number, leftEmpty: number) => event("RESTOCK_SESSION_FINALIZED", { restockSessionId, physicalCloseConfirmed: true, filled, leftEmpty, exceptions: 0 });
  await assert.rejects(projectVaultMachineEvent(tx, finalize(1, 1)), errorCode("RESTOCK_NOT_COMPLETE"));
  session.items[1].commandTerminalAt = new Date();
  await assert.rejects(projectVaultMachineEvent(tx, finalize(2, 0)), errorCode("RESTOCK_COUNT_MISMATCH"));
  assert.equal(writes, 0);
  await projectVaultMachineEvent(tx, finalize(1, 1));
  assert.equal(writes, 1);
  assert.equal(query.where.mode, "CERTIFICATION");
  assert.equal(query.where.state, "ACTIVE");
});

test("profile filling requires a terminal command and explicit product fit confirmation", async () => {
  const item: any = { id: "item", state: "UNREVIEWED", plannedProductId: "sports-25", commandState: "SENT_UNKNOWN", commandTerminalAt: null };
  let writes = 0;
  const tx: any = { vaultRestockSession: { findFirst: async () => ({ mode: "CERTIFICATION", state: "ACTIVE", configVersionId: "config" }) }, vaultRestockItem: { findUnique: async () => item, update: async () => { writes++; } }, vaultConfigVersion: { findUnique: async () => ({ schemaVersion: 2 }) } };
  const review = (confirmed: boolean) => event("RESTOCK_DOOR_REVIEWED", { restockSessionId, doorId: "door-0001", outcome: "FILLED", notes: "Observed by operator", ...(confirmed ? { productFitConfirmed: true } : {}) });
  await assert.rejects(projectVaultMachineEvent(tx, review(true)), errorCode("RESTOCK_OBSERVATION_NOT_AVAILABLE"));
  item.commandTerminalAt = new Date();
  await assert.rejects(projectVaultMachineEvent(tx, review(false)), errorCode("PRODUCT_FIT_CONFIRMATION_REQUIRED"));
  await projectVaultMachineEvent(tx, review(true));
  assert.equal(writes, 1);
});

test("physical profile publication binds four scoped artifact hashes and an exact reviewed revision", async () => {
  const payload = config();
  payload.machineProfile.provenance = "QUALIFIED";
  payload.machineProfile.evidence = { geometryDigest: "a".repeat(64), wiringDigest: "b".repeat(64), capabilityDigest: "c".repeat(64), hardwareDigest: "d".repeat(64) };
  const input: any = { confirmPhrase: `QUALIFY ${payload.machineProfile.profileId} r1`, bindings: Object.keys(payload.machineProfile.evidence).map((kind) => ({ kind, artifactStorageKey: `vault-certification/profiles/${machineId}/${payload.machineProfile.profileId}/1/${kind}.json` })) };
  assert.throws(() => assertVaultProfilePublicationEvidence(payload, {}), errorCode("PROFILE_EVIDENCE_UNVERIFIED"));
  const checked: string[] = [];
  const proof = await verifyVaultProfileEvidence(payload, input, "admin", async (key, digest) => { checked.push(`${key}:${digest}`); return undefined as any; });
  assert.equal(checked.length, 4);
  assert.doesNotThrow(() => assertVaultProfilePublicationEvidence(payload, { profileEvidence: proof }));
  await assert.rejects(verifyVaultProfileEvidence(payload, { ...input, confirmPhrase: "yes" }, "admin"), errorCode("PROFILE_CONFIRMATION_REQUIRED"));
  await assert.rejects(verifyVaultProfileEvidence(payload, { ...input, bindings: input.bindings.map((entry: any) => ({ ...entry, artifactStorageKey: entry.artifactStorageKey.replace(machineId, saleId) })) }, "admin"), errorCode("PROFILE_EVIDENCE_SCOPE_INVALID"));
  await assert.rejects(verifyVaultProfileEvidence(payload, input, "admin", async () => { throw new VaultApiError(409, "ARTIFACT_DIGEST_MISMATCH", "Changed bytes"); }), errorCode("ARTIFACT_DIGEST_MISMATCH"));
  payload.machineProfile.doors[0]!.label = "Revised";
  assert.throws(() => assertVaultProfilePublicationEvidence(payload, { profileEvidence: proof }), errorCode("PROFILE_EVIDENCE_UNVERIFIED"));
});

test("synthetic certification evidence never becomes physical qualification and coverage follows profile cardinality", () => {
  const payload = config(72);
  const result = evaluateVaultCertificationApproval({ status: "REVIEW_REQUIRED", sourceCommit: "a".repeat(40), appBuild: "0.1.0", localSchemaVersion: 1, contractVersion: 1, configVersion: { digest: "a".repeat(64), canonicalPayload: payload }, nayaxAdapterVersion: "test", nayaxSdkVersion: "test", nayaxFlowConfig: { mode: "MOCK" }, controllerIdentity: { mode: "MOCK" }, hardwareIdentity: {}, evidenceSummary: {}, unresolvedDeviations: [], evidence: [] });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("PHYSICAL_PROFILE_QUALIFICATION_REQUIRED"));
  assert.equal(result.counts.purchaseDoorsComplete, 0);
});

test("raw JSON wrapper returns bounded JSON errors for malformed, invalid UTF-8 and chunked bodies", async () => {
  async function run(chunks: Buffer[], maximum = 32, actionLimit = maximum) {
    const req = Object.assign(Readable.from(chunks), { method: "POST", headers: { "content-type": "application/json", "x-vault-contract-version": "1" } }) as unknown as NextApiRequest;
    let status = 200, body: any;
    const res = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; } } as unknown as NextApiResponse;
    await withVaultJsonBody(async (request, response) => { try { requireVaultJson(request, actionLimit); response.status(200).json({ parsed: request.body }); } catch (error) { sendVaultError(response, "test-request", error); } }, maximum)(req, res);
    return { status, body };
  }
  assert.equal((await run([Buffer.from('{"ok":'), Buffer.from('true}')])).body.parsed.ok, true);
  for (const raw of [Buffer.from('{bad'), Buffer.from([0x22, 0xff, 0x22])]) {
    const result = await run([raw]);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "INVALID_JSON");
    assert.ok(result.body.requestId);
  }
  assert.equal((await run([Buffer.alloc(24, 32), Buffer.alloc(24, 32)])).body.error.code, "BODY_TOO_LARGE");
  assert.equal((await run([Buffer.from('                        {}')], 64, 16)).status, 413, "raw whitespace counts against each route's smaller limit");
});

test("reporting rejects impossible local dates and serializes large event sequences without precision loss", () => {
  assert.equal(VaultSalesQuerySchema.safeParse({ from: "2026-02-29" }).success, false);
  assert.equal(VaultSalesQuerySchema.safeParse({ through: "2026-13-01" }).success, false);
  assert.equal(VaultSalesQuerySchema.safeParse({ from: "2028-02-29" }).success, true);
  const dto = vaultMachineDto({ lastEventSequence: 9223372036854775807n, lastHeartbeatAt: null, lastCloudObservedAt: null, health: "READY", serviceLocked: false, status: "ACTIVE" });
  assert.equal(JSON.parse(JSON.stringify(dto)).lastEventSequence, "9223372036854775807");
});

test("all canonical machine restock, sale, payment and retry envelopes satisfy cloud typed parsing", async () => {
  for (const count of [null, 72, 125, 256]) {
    const fixture = count ? config(count) : null;
    const rig = await createRig({ configure: false, payment: new vault.DeterministicNayaxMock({ maxItems: 256, maxTotalCents: 1_000_000, cancellationBeforeAuthorization: true }), ...(fixture ? { controller: new vault.DeterministicControllerSimulator(fixture.doorMapping) } : {}) });
    try {
      const signed = count ? makeSyntheticConfig(rig.machineId, 1, rig.keyPair.privateKey, count) : makeConfig(rig.machineId, 1, rig.keyPair.privateKey);
      signed.keyId = "test-config-key";
      await rig.machine.initialize();
      rig.machine.stageConfig(signed); rig.machine.activatePendingConfig(); rig.machine.markCloudContact();
      const actor = grant(rig, "TECHNICIAN");
      const doors = count === 256 ? signed.payload.machineProfile.doors.map((door: any) => door.doorId) : [signed.payload.doorMapping[0].doorId];
      const restock = await rig.operations.startOrResumeRestock(actor.sessionId, doors);
      for (const doorId of doors) {
        rig.operations.recordRestockOutcome(actor.sessionId, restock.sessionId, doorId, "FILLED", "Synthetic observed fit", true);
        await rig.operations.startOrResumeRestock(actor.sessionId, doors);
      }
      rig.operations.finalizeRestock(actor.sessionId, restock.sessionId, true);
      rig.machine.staff.safeExit(actor.sessionId, true);
      for (const doorId of doors) rig.machine.selectCartDoor(doorId, "sports-25", true);
      const sale = (await rig.machine.checkout({ idempotencyKey: randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: doors })).sale;
      await rig.machine.startPayment(sale.saleId, randomUUID()); await rig.machine.advancePayments();
      await rig.machine.openPaidDoorsAgain(sale.saleId, randomUUID()); rig.machine.markPresentationDone(sale.saleId);
      const envelopes = rig.store.all("SELECT payload_json FROM outbox ORDER BY sequence").map((row: any) => JSON.parse(row.payload_json));
      for (const envelope of envelopes) assert.doesNotThrow(() => normalizeTypedVaultEvent(envelope), `profile ${count ?? "legacy"} event ${envelope.sequence} ${envelope.type}: ${JSON.stringify(envelope.payload)}`);
      assert.equal(envelopes.find((envelope: any) => envelope.type === "SALE_RESERVED").payload.items.length, doors.length);
    } finally { rig.store.close(); }
  }
});
