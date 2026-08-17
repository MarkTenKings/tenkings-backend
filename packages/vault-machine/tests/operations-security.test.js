const test = require("node:test");
const assert = require("node:assert/strict");
const { createRig, grant, crypto } = require("./helpers");

test("six-digit scrypt grants enforce generic failure, exponential backoff and role boundaries", async () => {
  const rig = await createRig();
  const verifier = rig.vault.createScryptPinVerifier("123456"); assert.equal(rig.vault.verifyScryptPin("123456", verifier), true); assert.equal(rig.vault.verifyScryptPin("123455", verifier), false);
  const input = { grantId: crypto.randomUUID(), userId: "restocker", machineId: rig.machineId, role: "RESTOCKER", verifierVersion: 1, verifier, hashAlgorithm: "scrypt", hashParameters: { N: 16384, r: 8, p: 1 }, validFrom: "2026-08-16T00:00:00.000Z", expiresAt: "2027-08-16T00:00:00.000Z", revokedAt: null };
  rig.machine.staff.importGrant(input);
  for (let index = 0; index < 3; index++) assert.throws(() => rig.machine.staff.authenticate("restocker", "000000"), /authentication failed/i);
  assert.throws(() => rig.machine.staff.authenticate("restocker", "123456"), /authentication failed/i); // backoff is deliberately generic
  rig.clock.advance(3000); const session = rig.machine.staff.authenticate("restocker", "123456");
  assert.throws(() => rig.machine.staff.requireSession(session.sessionId, "DOOR_TEST"), /does not permit/i); assert.equal(rig.machine.staff.requireSession(session.sessionId, "RESTOCK_RUN").role, "RESTOCKER");
  rig.store.close();
});

test("resumable restock records every door and only FILLED restores availability", async () => {
  const rig = await createRig(); const session = grant(rig, "RESTOCKER");
  const started = await rig.operations.startOrResumeRestock(session.sessionId, ["X-01", "K-01", "I-01"]);
  const resumed = await rig.operations.startOrResumeRestock(session.sessionId); assert.equal(resumed.sessionId, started.sessionId);
  const durableState = await rig.machine.publicState(); assert.equal(durableState.activeRestock.items.length, 3); assert.equal(durableState.activeRestock.items[0].outcome, "UNREVIEWED"); assert.equal(durableState.activeRestock.items[0].productName, "Sports Mystery Pack");
  const outcomes = { "X-01": "FILLED", "K-01": "LEFT_EMPTY", "I-01": "EXCEPTION" };
  for (let index = 0; index < 3; index++) {
    const state = await rig.machine.publicState(); const item = state.activeRestock.items.find((entry) => entry.command && !entry.command.observationRecorded);
    assert.equal(item.command.terminal, true);
    rig.operations.recordRestockOutcome(session.sessionId, started.sessionId, item.doorId, outcomes[item.doorId], item.doorId === "I-01" ? "damaged latch" : "");
    if (index < 2) await rig.operations.startOrResumeRestock(session.sessionId);
  }
  assert.equal(rig.store.one(`SELECT state FROM door WHERE door_id='X-01'`).state, "AVAILABLE"); assert.equal(rig.store.one(`SELECT state FROM door WHERE door_id='K-01'`).state, "EMPTY"); assert.equal(rig.store.one(`SELECT state FROM door WHERE door_id='I-01'`).state, "EXCEPTION");
  const result = rig.operations.finalizeRestock(session.sessionId, started.sessionId, true); assert.deepEqual(result, { filled: 1, leftEmpty: 1, exceptions: 1 });
  rig.machine.staff.safeExit(session.sessionId, true); assert.equal(rig.store.one(`SELECT service_locked FROM machine_meta`).service_locked, 0); rig.store.close();
});

test("staff inactivity locks service and restart never silently returns to public", async () => {
  const rig = await createRig(); const session = grant(rig, "TECHNICIAN"); rig.clock.advance(120001);
  assert.throws(() => rig.machine.staff.requireSession(session.sessionId, "DIAGNOSTICS_VIEW"), /locked/i);
  assert.equal(rig.store.one(`SELECT service_locked FROM machine_meta`).service_locked, 1); assert.ok(rig.store.one(`SELECT locked_at FROM staff_session WHERE session_id=?`, session.sessionId).locked_at); rig.store.close();
});

test("certification scheduler is deterministic and wrong-door evidence stops all automation", async () => {
  const rig = await createRig(); const session = grant(rig, "TECHNICIAN"); rig.controller.script({ fault: "WRONG_DOOR", observedDoorId: "K-01" });
  const certification = await rig.operations.startCertification(session.sessionId);
  assert.equal(certification.scheduledDoorId, "G-01"); assert.equal(rig.store.one(`SELECT automation_halted FROM machine_meta`).automation_halted, 1);
  const retention = rig.store.one(`SELECT retention_policy,service_life_ended_at,purge_eligible_at FROM certification_session WHERE session_id=?`, certification.sessionId);
  assert.deepEqual(retention, { retention_policy: "SERVICE_LIFE_PLUS_3_YEARS", service_life_ended_at: null, purge_eligible_at: null });
  const command = (await rig.machine.publicState()).activeCertification.currentCommand;
  const evidence = { evidenceId: crypto.randomUUID(), sessionId: certification.sessionId, doorId: certification.scheduledDoorId, evidenceClass: "AUTOMATED", outcome: "PASS", expectedDoorIds: [certification.scheduledDoorId], observedDoorIds: [command.observedDoorId], notes: "simulated mismatch", artifactDigest: "a".repeat(64), observedAt: rig.clock.now().toISOString() };
  assert.deepEqual(rig.operations.recordCertificationEvidence(session.sessionId, evidence), { critical: true }); assert.equal(rig.store.one(`SELECT status FROM certification_session WHERE session_id=?`, certification.sessionId).status, "CRITICAL_STOP");
  assert.equal((await rig.machine.readiness()).reasons.includes("PHYSICAL_AUTOMATION_HALTED"), true); rig.store.close();
});

test("recursive structured log redaction removes PIN, PAN, tokens and secrets", () => {
  const value = require("../../vault-contracts/dist").redactVaultValue({ ok: "visible", pin: "123456", nested: { bearerToken: "abc", pan: "411111", privateKey: "secret" } });
  assert.deepEqual(value, { ok: "visible", pin: "[REDACTED]", nested: { bearerToken: "[REDACTED]", pan: "[REDACTED]", privateKey: "[REDACTED]" } });
});
