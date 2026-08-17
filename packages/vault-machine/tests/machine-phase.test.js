const test = require("node:test");
const assert = require("node:assert/strict");
const { createRig, grant, makeDoorAvailable, crypto, tempDatabase, closeAndRemove } = require("./helpers");

test("public activity is durable, state-versioned, and unavailable during service lock", async () => {
  const rig = await createRig();
  await rig.machine.initialize();
  const initial = await rig.machine.publicState();
  assert.deepEqual(initial.buildIdentity, { sourceCommit: "test-source-commit", appVersion: "0.1.0" });
  assert.equal(initial.idleSecondsRemaining, 60);
  rig.clock.advance(45_000);
  assert.equal((await rig.machine.publicState()).idleSecondsRemaining, 15);
  const version = rig.machine.recordPublicActivity();
  assert.equal(version, initial.stateVersion + 1);
  assert.equal((await rig.machine.publicState()).idleSecondsRemaining, 60);
  assert.equal(rig.store.one(`SELECT type FROM machine_event ORDER BY sequence DESC LIMIT 1`).type, "PUBLIC_ACTIVITY_RECORDED");
  grant(rig, "RESTOCKER");
  assert.throws(() => rig.machine.recordPublicActivity(), /service is locked/i);
  rig.store.close();
});

test("idle warning is machine-derived and resets only an unpaid cart at expiry", async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01"]);
  await rig.machine.initialize();
  rig.machine.selectCartDoor("X-01", "sports-25", true);
  rig.clock.advance(45_000);
  const warning = await rig.machine.publicState();
  assert.equal(warning.publicState, "IDLE_WARNING");
  assert.equal(warning.idleSecondsRemaining, 15);
  rig.clock.advance(15_000);
  const reset = await rig.machine.publicState();
  assert.equal(reset.publicState, "ATTRACT");
  assert.equal(reset.idleSecondsRemaining, 60);
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM cart_item`).count, 0);
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM machine_event WHERE type='PUBLIC_IDLE_CART_RESET'`).count, 1);
  rig.store.close();
});

test("paid retrieval countdown is durable, extends once for the exact retry, and clears presentation at expiry", async () => {
  const rig = await createRig(); makeDoorAvailable(rig, ["X-01", "K-01"]);
  rig.machine.selectCartDoor("X-01", "sports-25", true);
  const checkout = await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["X-01"] });
  const paid = await rig.machine.startPayment(checkout.sale.saleId, crypto.randomUUID());
  let state = await rig.machine.publicState();
  assert.equal(state.publicState, "PAID_RESET_COUNTDOWN");
  assert.equal(state.activeSale.retrievalSecondsRemaining, 30);
  assert.equal(state.activeSale.resetSecondsRemaining, 30);
  assert.ok(rig.store.one(`SELECT presentation_started_at,presentation_expires_at FROM sale WHERE sale_id=?`, paid.saleId).presentation_expires_at);

  rig.clock.advance(12_000);
  state = await rig.machine.publicState();
  assert.equal(state.activeSale.resetSecondsRemaining, 18);
  await rig.machine.openPaidDoorsAgain(paid.saleId, crypto.randomUUID());
  state = await rig.machine.publicState();
  assert.equal(state.publicState, "PAID_RESET_COUNTDOWN");
  assert.equal(state.activeSale.retryUsed, true);
  assert.equal(state.activeSale.resetSecondsRemaining, 48);

  rig.clock.advance(47_000);
  assert.equal((await rig.machine.publicState()).activeSale.resetSecondsRemaining, 1);
  rig.clock.advance(1_000);
  state = await rig.machine.publicState();
  assert.equal(state.activeSale, null);
  assert.equal(state.publicState, "ATTRACT");
  const completed = rig.store.one(`SELECT state,presentation_done_at FROM sale WHERE sale_id=?`, paid.saleId);
  assert.equal(completed.state, "COMPLETED");
  assert.ok(completed.presentation_done_at);
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM machine_event WHERE type='PUBLIC_PRESENTATION_DONE' AND correlation_id=?`, paid.saleId).count, 1);

  rig.machine.selectCartDoor("K-01", "sports-25", true);
  const next = await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["K-01"] });
  assert.ok(next.sale);
  rig.store.close();
});

test("paid presentation deadline survives a local service restart", async () => {
  const location = tempDatabase();
  const first = await createRig({ databasePath: location.path }); makeDoorAvailable(first, ["X-01"]);
  first.machine.selectCartDoor("X-01", "sports-25", true);
  const checkout = await first.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: "PRODUCTION", configVersion: 1, doorIds: ["X-01"] });
  await first.machine.startPayment(checkout.sale.saleId, crypto.randomUUID());
  first.clock.advance(10_000);
  first.store.close();

  const resumed = await createRig({ databasePath: location.path, machineId: first.machineId, keyPair: first.keyPair, clock: first.clock, configure: false });
  await resumed.machine.initialize();
  const state = await resumed.machine.publicState();
  assert.equal(state.publicState, "PAID_RESET_COUNTDOWN");
  assert.equal(state.activeSale.resetSecondsRemaining, 20);
  resumed.clock.advance(20_000);
  assert.equal((await resumed.machine.publicState()).activeSale, null);
  closeAndRemove(resumed, location.directory);
});

test("restock and certification expose terminal command phases before observations", async () => {
  const restockRig = await createRig(); const restocker = grant(restockRig, "RESTOCKER");
  const restock = await restockRig.operations.startOrResumeRestock(restocker.sessionId, ["X-01", "K-01"]);
  assert.equal(JSON.parse(restockRig.store.one(`SELECT payload_json FROM machine_event WHERE type='RESTOCK_SESSION_STARTED'`).payload_json).restockSessionId, restock.sessionId);
  let restockState = (await restockRig.machine.publicState()).activeRestock;
  const first = restockState.items.find((item) => item.command && !item.command.observationRecorded);
  assert.equal(first.command.doorId, first.doorId);
  assert.equal(first.command.terminal, true);
  restockRig.operations.recordRestockOutcome(restocker.sessionId, restock.sessionId, first.doorId, "FILLED");
  restockState = (await restockRig.machine.publicState()).activeRestock;
  assert.equal(restockState.items.find((item) => item.doorId === first.doorId).command.observationRecorded, true);
  assert.equal(restockState.items.filter((item) => item.command && !item.command.observationRecorded).length, 0);
  await restockRig.operations.startOrResumeRestock(restocker.sessionId);
  assert.equal((await restockRig.machine.publicState()).activeRestock.items.filter((item) => item.command && !item.command.observationRecorded).length, 1);
  restockRig.store.close();

  const certificationRig = await createRig(); const technician = grant(certificationRig, "TECHNICIAN");
  const certification = await certificationRig.operations.startCertification(technician.sessionId);
  assert.equal(JSON.parse(certificationRig.store.one(`SELECT payload_json FROM machine_event WHERE type='CERTIFICATION_SESSION_STARTED'`).payload_json).certificationSessionId, certification.sessionId);
  let certificationState = (await certificationRig.machine.publicState()).activeCertification;
  assert.equal(certificationState.currentCommand.commandId, certification.commandId);
  assert.equal(certificationState.currentCommand.doorId, certification.scheduledDoorId);
  assert.equal(certificationState.currentCommand.terminal, true);
  assert.equal(certificationState.currentCommand.observationRecorded, false);
  const evidence = { evidenceId: require("node:crypto").randomUUID(), sessionId: certification.sessionId, doorId: certification.scheduledDoorId, evidenceClass: "AUTOMATED", outcome: "PASS", expectedDoorIds: [certification.scheduledDoorId], observedDoorIds: [certification.scheduledDoorId], notes: "simulated exact-door observation", artifactDigest: "b".repeat(64), observedAt: certificationRig.clock.now().toISOString() };
  certificationRig.operations.recordCertificationEvidence(technician.sessionId, evidence);
  certificationState = (await certificationRig.machine.publicState()).activeCertification;
  assert.equal(certificationState.currentCommand.observationRecorded, true);
  const next = await certificationRig.operations.startCertification(technician.sessionId);
  assert.notEqual(next.commandId, certification.commandId);
  assert.equal((await certificationRig.machine.publicState()).activeCertification.currentCommand.observationRecorded, false);
  certificationRig.store.close();
});

test("certification fails closed without trusted source-commit provenance", async () => {
  const rig = await createRig({ sourceCommit: "UNVERIFIED" }); const technician = grant(rig, "TECHNICIAN");
  await assert.rejects(() => rig.operations.startCertification(technician.sessionId), /trusted service source-commit/i);
  assert.equal(rig.store.maybeOne(`SELECT session_id FROM certification_session`), undefined);
  rig.store.close();
});

test("certification coverage scheduling is scoped to the current session", async () => {
  const rig = await createRig(); const technician = grant(rig, "TECHNICIAN");
  const first = await rig.operations.startCertification(technician.sessionId);
  const firstDoorId = first.scheduledDoorId;
  rig.operations.recordCertificationEvidence(technician.sessionId, {
    evidenceId: crypto.randomUUID(), sessionId: first.sessionId, doorId: first.scheduledDoorId, evidenceClass: "AUTOMATED", outcome: "PASS",
    expectedDoorIds: [first.scheduledDoorId], observedDoorIds: [first.scheduledDoorId], notes: "historical session", artifactDigest: "c".repeat(64), observedAt: rig.clock.now().toISOString(),
  });
  rig.operations.submitCertification(technician.sessionId, first.sessionId, true);
  const second = await rig.operations.startCertification(technician.sessionId);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(second.scheduledDoorId, firstDoorId);
  assert.equal((await rig.machine.publicState()).activeCertification.nextUnderTestedDoorId, firstDoorId);
  rig.store.close();
});

test("locked service reauthentication resumes the same durable restock identity", async () => {
  const rig = await createRig(); const first = grant(rig, "RESTOCKER");
  const started = await rig.operations.startOrResumeRestock(first.sessionId, ["X-01"]);
  rig.machine.staff.lock(first.sessionId, "INACTIVITY");
  const resumedStaff = rig.machine.staff.authenticate("restocker-user", "123456");
  const resumed = await rig.operations.startOrResumeRestock(resumedStaff.sessionId);
  assert.equal(resumed.sessionId, started.sessionId);
  assert.equal(rig.store.one(`SELECT actor_session_id FROM restock_session WHERE session_id=?`, started.sessionId).actor_session_id, resumedStaff.sessionId);
  assert.throws(() => rig.machine.staff.safeExit(resumedStaff.sessionId, true), /restock must be finalized/i);
  rig.store.close();
});

test("certification must be submitted after exact command evidence before public safe exit", async () => {
  const rig = await createRig();
  const session = grant(rig, "TECHNICIAN", "123456", "cert-submit-tech");
  const started = await rig.operations.startCertification(session.sessionId);
  const now = rig.clock.now().toISOString();
  rig.operations.recordCertificationEvidence(session.sessionId, {
    evidenceId: require("node:crypto").randomUUID(), sessionId: started.sessionId, doorId: started.scheduledDoorId, evidenceClass: "FULL_MACHINE", outcome: "PASS",
    expectedDoorIds: [started.scheduledDoorId], observedDoorIds: [started.scheduledDoorId], notes: "Observed", artifactDigest: "a".repeat(64), observedAt: now,
  });
  assert.throws(() => rig.machine.staff.safeExit(session.sessionId, true), /submitted/i);
  rig.machine.staff.lock(session.sessionId, "TEST_REAUTH");
  const freshSession = rig.machine.staff.authenticate("cert-submit-tech", "123456");
  rig.operations.submitCertification(freshSession.sessionId, started.sessionId, true);
  assert.equal(rig.store.one(`SELECT status FROM certification_session WHERE session_id=?`, started.sessionId).status, "REVIEW_REQUIRED");
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE certification_session_id=?`, started.sessionId).count, 1);
  rig.machine.staff.safeExit(freshSession.sessionId, true);
  assert.equal((await rig.machine.publicState()).serviceLocked, false);
  rig.store.close();
});
