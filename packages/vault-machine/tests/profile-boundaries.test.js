const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createRig, makeConfig, makeDoorAvailable, grant, tempDatabase, crypto, FakeClock, contracts, vault } = require('./helpers');
const { makeSyntheticConfig } = require('../../vault-contracts/tests/profile-fixtures');

function signConfig(payload, key) {
  return { payload, digest: contracts.configDigest(payload), keyId: 'test-config-key', algorithm: 'Ed25519', signature: crypto.sign(null, Buffer.from(contracts.canonicalJson(payload)), key).toString('base64') };
}

async function acknowledgeTestOutbox(rig) {
  const sync = new vault.OutboxSynchronizer(rig.store, rig.clock, { send: async events => ({ acknowledgedEventIds: events.map(event => event.eventId), rejected: [] }) });
  while (sync.pressure().count) assert.equal((await sync.flush()).rejected, 0);
  rig.machine.markCloudContact(); // Successful runtime cycles leave this audit pending.
}

async function profileRig(count, options = {}) {
  const rig = await createRig({ ...options, configure: false });
  const generated = makeSyntheticConfig(rig.machineId, 1, rig.keyPair.privateKey, count);
  rig.signed = signConfig(generated.payload, rig.keyPair.privateKey);
  rig.controller = new vault.DeterministicControllerSimulator(rig.signed.payload.doorMapping);
  rig.machine = new vault.VaultMachine(rig.store, rig.payment, rig.controller, { pinnedConfigKeys: { 'test-config-key': rig.keyPair.publicKey.export({ type: 'spki', format: 'pem' }) }, appVersion: '0.1.0', clock: rig.clock });
  rig.operations = new vault.VaultOperationsService(rig.machine, rig.clock);
  rig.machine.stageConfig(rig.signed); assert.equal(rig.machine.activatePendingConfig().activated, true); rig.machine.markCloudContact();
  return rig;
}

test('varying irregular synthetic profiles preserve explicit endpoint addresses through restock, payment and exact retry', async () => {
  for (const count of [1, 7, 32, 72, 125, 150, 256]) {
    const rig = await profileRig(count);
    try {
      const payload = rig.signed.payload, ids = payload.machineProfile.doors.map(door => door.doorId);
      const state = await rig.machine.publicState();
      assert.equal(state.configSchemaVersion, 2); assert.deepEqual(state.machineProfile, payload.machineProfile);
      assert.deepEqual(state.doors.map(door => door.doorId), ids);
      assert.equal(state.providerLimits.maxItems, 25, 'Payment/cart limits do not grow with controller channels');
      const selected = [ids[0], ids[Math.floor(count / 2)], ids[count - 1]].filter((id, index, all) => all.indexOf(id) === index);
      const actor = grant(rig, 'TECHNICIAN');
      const restock = await rig.operations.startOrResumeRestock(actor.sessionId, selected);
      for (let index = 0; index < selected.length; index += 1) {
        const view = (await rig.machine.publicState()).activeRestock;
        assert.deepEqual(view.machineProfile, payload.machineProfile);
        const current = view.items.find(item => item.outcome === 'UNREVIEWED' && item.command?.terminal);
        assert.ok(current); assert.equal(current.doorLabel, payload.machineProfile.doors.find(door => door.doorId === current.doorId).label);
        assert.throws(() => rig.operations.recordRestockOutcome(actor.sessionId, restock.sessionId, current.doorId, 'FILLED'), error => error.code === 'PRODUCT_FIT_CONFIRMATION_REQUIRED');
        rig.operations.recordRestockOutcome(actor.sessionId, restock.sessionId, current.doorId, 'FILLED', 'Synthetic packaged-product fit confirmed', true);
        if (index + 1 < selected.length) await rig.operations.startOrResumeRestock(actor.sessionId);
      }
      rig.operations.finalizeRestock(actor.sessionId, restock.sessionId, true); rig.machine.staff.safeExit(actor.sessionId, true);
      for (const id of selected) rig.machine.selectCartDoor(id, 'sports-25', true);
      const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: selected })).sale;
      const paymentKey = crypto.randomUUID();
      await Promise.all([rig.machine.startPayment(sale.saleId, paymentKey), rig.machine.startPayment(sale.saleId, paymentKey)]);
      rig.clock.advance(130_000); // Existing paid retry works after cloud freshness expires.
      await rig.machine.openPaidDoorsAgain(sale.saleId, crypto.randomUUID());
      await rig.machine.advancePayments(); rig.machine.markPresentationDone(sale.saleId);
      assert.equal(rig.machine.publicSale(sale.saleId).paymentState, 'SETTLED');
      const commands = rig.store.all("SELECT * FROM command_intent WHERE sale_id=? ORDER BY attempt,door_id", sale.saleId);
      assert.equal(commands.length, selected.length * 2);
      for (const command of commands) {
        const expected = payload.doorMapping.find(entry => entry.doorId === command.door_id);
        assert.equal(command.controller_channel, expected.controllerChannel);
        assert.equal(command.controller_endpoint_id, expected.controllerEndpointId);
        assert.equal(command.profile_digest, contracts.machineProfileDigest(payload.machineProfile));
        assert.equal(command.door_label, payload.machineProfile.doors.find(door => door.doorId === command.door_id).label);
      }
      assert.equal(rig.controller.maxObservedConcurrency(), 1);
      assert.throws(() => rig.store.run("UPDATE sale_item SET door_label='changed'"), /immutable/i);
      assert.throws(() => rig.store.run("UPDATE command_intent SET controller_endpoint_id='wrong-board'"), /immutable/i);
      assert.throws(() => rig.store.run("UPDATE restock_session SET config_version=2"), /immutable/i);
      assert.throws(() => rig.store.run("UPDATE restock_item SET planned_product_id='changed'"), /immutable/i);
      const event = JSON.parse(rig.store.one("SELECT payload_json FROM machine_event WHERE type='SALE_RESERVED'").payload_json);
      assert.equal(event.items.every(item => item.doorLabel && item.controllerEndpointId && item.profileDigest), true);
      assert.equal(rig.store.all('PRAGMA foreign_key_check').length, 0);
    } finally { rig.store.close(); }
  }
});

test('a complete 256-door synthetic sale fits the bounded event contract when independent provider limits permit it', async () => {
  const rig = await profileRig(256, { payment: new vault.DeterministicNayaxMock({ maxItems: 256, maxTotalCents: 1_000_000, cancellationBeforeAuthorization: true }) });
  try {
    const ids = rig.signed.payload.machineProfile.doors.map(door => door.doorId);
    makeDoorAvailable(rig, ids);
    for (const id of ids) rig.machine.selectCartDoor(id, 'sports-25', true);
    const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ids })).sale;
    assert.equal(sale.items.length, 256);
    const reserved = JSON.parse(rig.store.one("SELECT payload_json FROM machine_event WHERE type='SALE_RESERVED'").payload_json);
    assert.equal(reserved.items.length, 256); assert.doesNotThrow(() => contracts.assertVaultEventPayloadBounds(reserved));
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
    assert.equal(rig.controller.receipts.length, 256); assert.equal(rig.controller.maxObservedConcurrency(), 1);
    assert.equal(rig.machine.publicSale(sale.saleId).retryAvailable, true);
    assert.equal(rig.store.all('PRAGMA foreign_key_check').length, 0);
  } finally { rig.store.close(); }
});

test('profile activation is exact, empty-machine, service-authorized and preserves all legacy history', async () => {
  const rig = await createRig();
  try {
    const original = rig.store.one('SELECT payload_json,signed_json FROM config_snapshot WHERE version=1');
    const next = signConfig(makeSyntheticConfig(rig.machineId, 2, rig.keyPair.privateKey, 72).payload, rig.keyPair.privateKey);
    rig.machine.stageConfig(next);
    assert.deepEqual(rig.machine.activatePendingConfig().reasons, ['PROFILE_RECONFIGURATION_REQUIRED']);
    let actor = grant(rig, 'RESTOCKER');
    assert.throws(() => rig.machine.activatePendingProfile(actor.sessionId, 2, next.digest, true, true), /does not permit/);
    actor = grant(rig, 'TECHNICIAN', '654321', 'profile-technician');
    assert.throws(() => rig.machine.activatePendingProfile(actor.sessionId, 2, 'f'.repeat(64), true, true), error => error.code === 'PROFILE_ACTIVATION_CHANGED');
    assert.throws(() => rig.machine.activatePendingProfile(actor.sessionId, 2, next.digest, false, true), /confirmation/i);
    makeDoorAvailable(rig);
    assert.throws(() => rig.machine.activatePendingProfile(actor.sessionId, 2, next.digest, true, true), /reconciled and empty/);
    assert.equal(rig.machine.staff.requireSession(actor.sessionId).sessionId, actor.sessionId, 'Failed activation leaves staff authority intact');
    rig.store.run("UPDATE door SET state='EMPTY',product_id=NULL WHERE door_id='X-01'"); // Disposable physical-empty fixture only.
    await acknowledgeTestOutbox(rig);
    rig.machine.activatePendingProfile(actor.sessionId, 2, next.digest, true, true);
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM door').n, 222);
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM door WHERE active=0').n, 150);
    assert.deepEqual(rig.store.one('SELECT payload_json,signed_json FROM config_snapshot WHERE version=1'), original);
    const state = await rig.machine.publicState(); assert.equal(state.doors.length, 72); assert.equal(state.serviceLocked, true); assert.equal(state.activeStaff, null);
    assert.throws(() => rig.store.run("DELETE FROM door WHERE active=0"), /retained/);
    assert.equal(rig.store.all('PRAGMA foreign_key_check').length, 0);
  } finally { rig.store.close(); }
});

test('retired stable IDs cannot be reintroduced with changed physical or address bindings', async () => {
  const rig = await profileRig(7);
  try {
    const previous = rig.signed.payload;
    const otherPayload = structuredClone(previous); otherPayload.version = 2; otherPayload.machineProfile.profileId = 'different-fixture';
    for (const door of otherPayload.machineProfile.doors) door.doorId = `new-${door.doorId}`;
    for (const mapping of otherPayload.doorMapping) mapping.doorId = `new-${mapping.doorId}`;
    otherPayload.assignments = Object.fromEntries(Object.entries(previous.assignments).map(([id, value]) => [`new-${id}`, value]));
    const other = signConfig(otherPayload, rig.keyPair.privateKey); rig.machine.stageConfig(other);
    let actor = grant(rig, 'TECHNICIAN'); await acknowledgeTestOutbox(rig); rig.machine.activatePendingProfile(actor.sessionId, 2, other.digest, true, true);
    const changed = structuredClone(previous); changed.version = 3; changed.machineProfile.revision = 2; changed.machineProfile.doors[0].label = 'Relabeled old compartment';
    const bad = signConfig(changed, rig.keyPair.privateKey); rig.machine.stageConfig(bad);
    actor = rig.machine.staff.authenticate(actor.userId, '123456');
    await acknowledgeTestOutbox(rig);
    assert.throws(() => rig.machine.activatePendingProfile(actor.sessionId, 3, bad.digest, true, true), error => error.code === 'RETIRED_DOOR_REBIND_FORBIDDEN');
    assert.equal(rig.machine.config.active().payload.version, 2); assert.equal(rig.machine.staff.requireSession(actor.sessionId).userId, actor.userId);
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM door WHERE active=1').n, 7);
  } finally { rig.store.close(); }
});

test('emptying a compartment cannot activate a new profile until its ordered reconciliation facts are acknowledged', async () => {
  const rig = await profileRig(7);
  try {
    const actor = grant(rig, 'TECHNICIAN'); const doorId = rig.signed.payload.machineProfile.doors[0].doorId;
    const restock = await rig.operations.startOrResumeRestock(actor.sessionId, [doorId]);
    rig.operations.recordRestockOutcome(actor.sessionId, restock.sessionId, doorId, 'LEFT_EMPTY', 'Observed empty');
    rig.operations.finalizeRestock(actor.sessionId, restock.sessionId, true);
    const nextPayload = structuredClone(rig.signed.payload); nextPayload.version = 2; nextPayload.machineProfile.revision++;
    [nextPayload.doorMapping[0].controllerChannel, nextPayload.doorMapping[1].controllerChannel] = [nextPayload.doorMapping[1].controllerChannel, nextPayload.doorMapping[0].controllerChannel];
    const next = signConfig(nextPayload, rig.keyPair.privateKey); rig.machine.stageConfig(next);
    assert.throws(() => rig.machine.activatePendingProfile(actor.sessionId, 2, next.digest, true, true), error => error.code === 'PROFILE_CLOUD_RECONCILIATION_REQUIRED');
    assert.equal(rig.machine.config.active().payload.version, 1);
    assert.equal(rig.machine.staff.requireSession(actor.sessionId).userId, actor.userId);
    const delivered = [];
    const cloud = { machineId: rig.machineId, config: async () => ({ config: null, unchanged: true }), staffGrants: async () => ({ grants: [], latestGrantVersion: 0, hasMore: false }),
      heartbeat: async input => { assert.equal(input.configVersion, delivered.length ? 2 : 1); return rig.clock.now(); },
      send: async events => { delivered.push(...events); return { acknowledgedEventIds: events.map(event => event.eventId), rejected: [] }; } };
    const runtime = new vault.VaultRuntime(rig.machine, cloud, { clock: rig.clock, broadcast: async () => {} });
    try {
      await runtime.synchronize();
      assert.ok(delivered.some(event => event.payload.type === 'RESTOCK_SESSION_FINALIZED'));
      assert.ok(runtime.outbox.pressure().count > 0);
      rig.machine.activatePendingProfile(actor.sessionId, 2, next.digest, true, true);
      await runtime.synchronize();
      assert.equal(rig.machine.config.active().payload.version, 2);
    } finally { await runtime.stop(); }
  } finally { rig.store.close(); }
});

test('profile activation during an in-flight heartbeat defers new-profile events until matching cloud membership exists', async () => {
  const rig = await profileRig(7); let runtime;
  try {
    const delivered = []; let cloudVersion = 1; let activateDuringHeartbeat;
    const cloud = { machineId: rig.machineId, config: async () => ({ config: null, unchanged: true }), staffGrants: async () => ({ grants: [], latestGrantVersion: 0, hasMore: false }),
      heartbeat: async input => { cloudVersion = input.configVersion; if (activateDuringHeartbeat) { const activate = activateDuringHeartbeat; activateDuringHeartbeat = null; activate(); } return rig.clock.now(); },
      send: async events => { for (const event of events) if (event.payload.type === 'PROFILE_RECONFIGURATION_ACTIVATED') assert.equal(event.payload.payload.configVersion, cloudVersion); delivered.push(...events); return { acknowledgedEventIds: events.map(event => event.eventId), rejected: [] }; } };
    runtime = new vault.VaultRuntime(rig.machine, cloud, { clock: rig.clock, broadcast: async () => {} });
    await runtime.synchronize();
    const actor = grant(rig, 'TECHNICIAN');
    const nextPayload = structuredClone(rig.signed.payload); nextPayload.version = 2; nextPayload.machineProfile.revision++; nextPayload.machineProfile.doors[0].label = 'Updated';
    const next = signConfig(nextPayload, rig.keyPair.privateKey); rig.machine.stageConfig(next);
    activateDuringHeartbeat = () => rig.machine.activatePendingProfile(actor.sessionId, 2, next.digest, true, true);
    const before = delivered.length;
    await assert.rejects(() => runtime.synchronize(), error => error.code === 'CLOUD_CONFIG_CHANGED_DURING_SYNC');
    assert.equal(rig.machine.config.active().payload.version, 2); assert.equal(cloudVersion, 1);
    assert.equal(delivered.length, before, 'New-profile facts must not be flushed after an older heartbeat');
    await runtime.synchronize();
    assert.equal(cloudVersion, 2);
    assert.ok(delivered.some(event => event.payload.type === 'PROFILE_RECONFIGURATION_ACTIVATED'));
  } finally { await runtime?.stop(); rig.store.close(); }
});

test('finished customer presentation still pins configuration and staff while payment is unresolved', async () => {
  const rig = await createRig();
  try {
    makeDoorAvailable(rig); rig.machine.selectCartDoor('X-01', 'sports-25', true);
    const sale = (await rig.machine.checkout({ idempotencyKey: crypto.randomUUID(), mode: 'CERTIFICATION', configVersion: 1, doorIds: ['X-01'] })).sale;
    await rig.machine.startPayment(sale.saleId, crypto.randomUUID()); rig.machine.markPresentationDone(sale.saleId);
    rig.machine.stageConfig(makeConfig(rig.machineId, 2, rig.keyPair.privateKey));
    assert.ok(rig.machine.activatePendingConfig().reasons.includes('ACTIVE_PAYMENT'));
    assert.throws(() => grant(rig, 'ADMIN'), /active transaction/i);
    await rig.machine.advancePayments();
    assert.equal(rig.machine.activatePendingConfig().activated, true);
    assert.equal(grant(rig, 'TECHNICIAN').role, 'TECHNICIAN');
  } finally { rig.store.close(); }
});

test('active certification owns inventory and rejects an unrelated ordinary restock', async () => {
  const rig = await profileRig(7);
  try {
    const actor = grant(rig, 'TECHNICIAN'); const cert = await rig.operations.startCertification(actor.sessionId);
    const state = (await rig.machine.publicState()).activeCertification;
    assert.equal(state.configSchemaVersion, 2); assert.deepEqual(state.machineProfile, rig.signed.payload.machineProfile);
    assert.equal(state.currentCommand.doorLabel, rig.signed.payload.machineProfile.doors.find(door => door.doorId === cert.scheduledDoorId).label);
    await assert.rejects(() => rig.operations.startOrResumeRestock(actor.sessionId), error => error.code === 'CERTIFICATION_OWNS_INVENTORY');
    assert.equal(rig.store.one('SELECT COUNT(*) AS n FROM restock_session').n, 0);
    assert.throws(() => rig.store.run('UPDATE certification_session SET config_version=99'), /immutable/i);
  } finally { rig.store.close(); }
});

test('v2 controller identity must match the signed profile before checkout or a service command', async () => {
  const rig = await profileRig(7);
  try {
    const identity = await rig.controller.identity(); let commands = 0;
    rig.controller.identity = async () => ({ ...identity, adapter: 'different-controller-interface' });
    rig.controller.sendOpenCommand = async () => { commands += 1; throw new Error('must not dispatch'); };
    assert.ok((await rig.machine.readiness()).reasons.includes('CONTROLLER_ADAPTER_IDENTITY_MISMATCH'));
    const actor = grant(rig, 'TECHNICIAN'); await rig.operations.startOrResumeRestock(actor.sessionId, [rig.signed.payload.machineProfile.doors[0].doorId]);
    assert.equal(commands, 0); assert.equal(rig.store.one('SELECT automation_halted FROM machine_meta').automation_halted, 1);
  } finally { rig.store.close(); }
});

test('local schema upgrade retains historical v1 paid-command recovery and reruns as a no-op', async () => {
  const temporary = tempDatabase(); const machineId = crypto.randomUUID(), keys = crypto.generateKeyPairSync('ed25519');
  const saleId = crypto.randomUUID(), lineId = crypto.randomUUID(), commandId = 'historical-pending-command';
  const signed = makeConfig(machineId, 1, keys.privateKey);
  const database = new Database(temporary.path);
  try {
    database.exec('CREATE TABLE schema_migration(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)');
    for (const migration of vault.MIGRATIONS.filter(entry => entry.version <= 2)) {
      database.exec(migration.sql); database.prepare('INSERT INTO schema_migration VALUES(?,?,?)').run(migration.version, migration.name, '2026-08-16T00:00:00.000Z');
    }
    database.prepare('INSERT INTO machine_meta(singleton,machine_id,app_version,source_commit,schema_version,active_config_version) VALUES(1,?,?,?,?,1)').run(machineId, '0.1.0', 'a'.repeat(40), 2);
    database.prepare('INSERT INTO config_snapshot(version,digest,key_id,payload_json,signed_json,received_at) VALUES(1,?,?,?,?,?)').run(signed.digest, signed.keyId, JSON.stringify(signed.payload), JSON.stringify(signed), '2026-08-16T00:00:00.000Z');
    for (const mapping of contracts.SIMULATOR_DOOR_MAPPING) database.prepare("INSERT INTO door(door_id,controller_channel,mapping_version,state) VALUES(?,?,'1','EMPTY')").run(mapping.doorId, mapping.controllerChannel);
    database.prepare("INSERT INTO cart_item VALUES('K-01','sports-25','2026-08-16T00:00:00.000Z')").run();
    database.prepare(`INSERT INTO sale(sale_id,support_reference,checkout_idempotency_key,checkout_request_digest,mode,state,config_version,config_digest,timezone,city,state_region,tax_rate_basis_points,tax_calculation_version,subtotal_cents,tax_cents,total_cents,payment_state,payment_intent_key,payment_request_digest,provider_session_id,created_at,updated_at)
      VALUES(?,'HISTORY-1','historic-checkout',?,'PRODUCTION','OPEN_COMMAND_PENDING',1,?,'America/Los_Angeles','Los Angeles','CA',825,?,2500,206,2706,'AUTHORIZED','historic-payment',?,'historic-provider','2026-08-16T00:00:00.000Z','2026-08-16T00:00:00.000Z')`).run(saleId, 'a'.repeat(64), signed.digest, contracts.VAULT_TAX_CALCULATION_VERSION, 'b'.repeat(64));
    database.prepare(`INSERT INTO sale_item(line_id,sale_id,door_id,product_id,product_name,photo_url,description,category,price_cents,tax_class,controller_channel,mapping_version,allocation_state,fulfillment_state)
      VALUES(?,?,'X-01','sports-25','Historical product','https://example.test/history.jpg','Preserved sale','SPORTS',2500,'GENERAL',1,'1','COMMITTED_SOLD','SENT_UNKNOWN')`).run(lineId, saleId);
    database.prepare("UPDATE door SET state='COMMITTED_SOLD',product_id='sports-25',owning_sale_id=? WHERE door_id='X-01'").run(saleId);
    database.prepare("INSERT INTO command_intent(command_id,sale_id,sale_item_id,door_id,controller_channel,mapping_version,attempt,authority,state,created_at,dispatched_at) VALUES(?,?,?,'X-01',1,'1',1,'PAID_SALE','SENT_UNKNOWN','2026-08-16T00:00:00.000Z','2026-08-16T00:00:00.000Z')").run(commandId, saleId, lineId);
  } finally { database.close(); }
  let store;
  try {
    store = new vault.VaultStore(temporary.path, { machineId, appVersion: '0.1.0' });
    assert.equal(store.integrityCheck().ok, true); assert.equal(store.one('SELECT COUNT(*) AS n FROM door').n, 150);
    assert.equal(store.one("SELECT door_label FROM door WHERE door_id='X-01'").door_label, 'X-01');
    assert.equal(store.one('SELECT signed_json FROM config_snapshot').signed_json, JSON.stringify(signed));
    assert.equal(store.one('SELECT payment_intent_key FROM sale').payment_intent_key, 'historic-payment');
    const controller = new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]);
    const machine = new vault.VaultMachine(store, new vault.DeterministicNayaxMock(), controller, { clock: new FakeClock(), appVersion: '0.1.0', pinnedConfigKeys: { 'test-config-key': keys.publicKey.export({ type: 'spki', format: 'pem' }) } });
    await machine.initialize(); assert.equal(controller.receipts.length, 0, 'Migration/recovery cannot replay the original uncertain effect');
    assert.equal(machine.publicSale(saleId).items[0].doorLabel, 'X-01');
    await machine.openPaidDoorsAgain(saleId, 'reviewed-historical-retry');
    assert.equal(controller.receipts.length, 1); assert.deepEqual(store.all('SELECT door_id,controller_channel,controller_endpoint_id,profile_digest,attempt FROM command_intent ORDER BY attempt'), [
      { door_id: 'X-01', controller_channel: 1, controller_endpoint_id: null, profile_digest: null, attempt: 1 },
      { door_id: 'X-01', controller_channel: 1, controller_endpoint_id: null, profile_digest: null, attempt: 2 },
    ]);
    machine.markPresentationDone(saleId);
    store.run("UPDATE sale SET payment_state='SETTLEMENT_PENDING' WHERE sale_id=?", saleId);
    await machine.advancePayments();
    const lifecycle = store.all('SELECT type,mode FROM machine_event WHERE correlation_id=?', saleId);
    for (const eventType of ['CONTROLLER_EFFECT_REMAINS_UNKNOWN', 'SALE_RECOVERY_EVALUATED', 'PAID_DOOR_GROUP_RETRY_COMMITTED', 'CONTROLLER_DISPATCH_BOUNDARY_ENTERED', 'CONTROLLER_COMMAND_TERMINAL', 'PUBLIC_PRESENTATION_DONE', 'PAYMENT_RECOVERY_RECONCILIATION_REQUIRED']) assert.ok(lifecycle.some(event => event.type === eventType), eventType);
    assert.ok(lifecycle.every(event => event.mode === 'PRODUCTION'), 'Historical event classification must remain pinned while every adapter in this test is simulated');
    const ledger = store.all('SELECT * FROM schema_migration'); store.close();
    store = new vault.VaultStore(temporary.path, { machineId, appVersion: '0.1.0' }); assert.deepEqual(store.all('SELECT * FROM schema_migration'), ledger);
    assert.equal(store.all('PRAGMA foreign_key_check').length, 0);
  } finally { store?.close(); fs.rmSync(temporary.directory, { recursive: true, force: true }); }
});
