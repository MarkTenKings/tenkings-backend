const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRig, makeDoorAvailable, contracts, vault } = require("./helpers");

function command(overrides = {}) {
  return {
    commandId: "cmd_review",
    doorId: "X-01",
    controllerChannel: 1,
    mappingVersion: "1",
    attempt: 1,
    authority: "PAID_SALE",
    ...overrides,
  };
}

async function authorize(rig, doorIds) {
  makeDoorAvailable(rig, doorIds);
  for (const doorId of doorIds) rig.machine.selectCartDoor(doorId, "sports-25", true);
  const sale = (await rig.machine.checkout({
    idempotencyKey: crypto.randomUUID(),
    mode: "PRODUCTION",
    configVersion: 1,
    doorIds,
  })).sale;
  await rig.machine.startPayment(sale.saleId, crypto.randomUUID());
  return sale.saleId;
}

test("controller map is an exact canonical 150-door bijection in both directions", async () => {
  const mapping = contracts.SIMULATOR_DOOR_MAPPING.map((entry) => ({ ...entry }));
  const simulator = new vault.DeterministicControllerSimulator(mapping);
  assert.deepEqual(await simulator.validateMapping(mapping), { valid: true, errors: [] });

  const nonCanonical = mapping.map((entry) => ({ ...entry }));
  nonCanonical[0].doorId = "Z-01";
  const canonicalResult = await simulator.validateMapping(nonCanonical);
  assert.equal(canonicalResult.valid, false);
  assert.ok(canonicalResult.errors.includes("NON_CANONICAL_DOOR"));
  assert.ok(canonicalResult.errors.includes("CANONICAL_DOOR_MISSING"));

  const remapped = mapping.map((entry) => ({ ...entry }));
  [remapped[0].controllerChannel, remapped[1].controllerChannel] = [remapped[1].controllerChannel, remapped[0].controllerChannel];
  const remapResult = await simulator.validateMapping(remapped);
  assert.equal(remapResult.valid, false);
  assert.ok(remapResult.errors.includes("DOOR_TO_CHANNEL_MISMATCH"));
  assert.ok(remapResult.errors.includes("CHANNEL_TO_DOOR_MISMATCH"));

  for (const entry of mapping) {
    const receipt = await simulator.sendOpenCommand(command({
      commandId: `map_${entry.controllerChannel}`,
      doorId: entry.doorId,
      controllerChannel: entry.controllerChannel,
    }));
    assert.equal(receipt.outcome, "ACCEPTED");
  }
  assert.equal(simulator.receipts.length, 150);
  assert.deepEqual(simulator.receipts.map((receipt) => receipt.controllerSequence), Array.from({ length: 150 }, (_, index) => index + 1));
});

test("fault injection is deterministic and WRONG_DOOR can never report the requested door", async () => {
  const simulator = new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]);
  simulator.script(
    { fault: "ACK" },
    { fault: "NAK" },
    { fault: "TIMEOUT" },
    { fault: "DISCONNECT" },
    { fault: "WRONG_DOOR", observedDoorId: "X-01" },
  );
  const receipts = [];
  for (let index = 0; index < 5; index += 1) receipts.push(await simulator.sendOpenCommand(command({ commandId: `fault_${index}` })));
  assert.deepEqual(receipts.map(({ outcome }) => outcome), ["ACCEPTED", "REJECTED", "TIMEOUT", "SENT_UNKNOWN", "ACCEPTED"]);
  assert.deepEqual(receipts.map(({ evidenceCode }) => evidenceCode ?? null), [null, "SIMULATED_NAK", "SIMULATED_TIMEOUT", "TRANSPORT_DISCONNECTED", "WRONG_DOOR"]);
  assert.notEqual(receipts[4].observedDoorId, "X-01");
  assert.deepEqual(receipts.map(({ controllerSequence }) => controllerSequence), [1, 2, 3, 4, 5]);
});

test("adapter rejects invalid authority, invalid attempts, and non-customer second attempts before effects", async () => {
  const simulator = new vault.DeterministicControllerSimulator([...contracts.SIMULATOR_DOOR_MAPPING]);
  const invalidAuthority = await simulator.sendOpenCommand(command({ authority: "UNPAID" }));
  const invalidAttempt = await simulator.sendOpenCommand(command({ attempt: 3 }));
  const invalidRestockRetry = await simulator.sendOpenCommand(command({ authority: "RESTOCK", attempt: 2 }));
  assert.deepEqual(
    [invalidAuthority, invalidAttempt, invalidRestockRetry].map(({ outcome, evidenceCode }) => [outcome, evidenceCode]),
    [
      ["REJECTED", "AUTHORITY_INVALID"],
      ["REJECTED", "ATTEMPT_INVALID"],
      ["REJECTED", "AUTHORITY_ATTEMPT_MISMATCH"],
    ],
  );
});

test("serialized paid commands persist deterministic attempts 1 and 2 for every original door only", async () => {
  const rig = await createRig();
  const doorIds = ["X-01", "K-01", "I-01"];
  rig.controller.script(...Array.from({ length: 6 }, () => ({ fault: "ACK", delayMs: 2 })));
  const saleId = await authorize(rig, doorIds);
  const attemptOne = rig.store.all(`SELECT command_intent.command_id,sale_item.line_id,command_intent.door_id,command_intent.attempt,command_intent.authority FROM command_intent JOIN sale_item ON command_intent.sale_item_id=sale_item.line_id WHERE command_intent.sale_id=? ORDER BY command_intent.door_id`, saleId);
  assert.equal(rig.controller.maxObservedConcurrency(), 1);
  assert.deepEqual(attemptOne.map(({ door_id, attempt, authority }) => [door_id, attempt, authority]), [
    ["I-01", 1, "PAID_SALE"], ["K-01", 1, "PAID_SALE"], ["X-01", 1, "PAID_SALE"],
  ]);
  for (const row of attemptOne) {
    const expected = `cmd_${crypto.createHash("sha256").update([saleId, row.line_id, "1"].join("\u001f")).digest("hex").slice(0, 40)}`;
    assert.equal(row.command_id, expected);
  }

  const retryKey = crypto.randomUUID();
  await rig.machine.openPaidDoorsAgain(saleId, retryKey);
  await rig.machine.openPaidDoorsAgain(saleId, retryKey);
  await assert.rejects(() => rig.machine.openPaidDoorsAgain(saleId, crypto.randomUUID()), /already consumed/i);
  const all = rig.store.all(`SELECT command_id,sale_item_id,door_id,attempt,authority FROM command_intent WHERE sale_id=? ORDER BY attempt,door_id`, saleId);
  assert.equal(all.length, 6);
  assert.deepEqual(all.map(({ door_id, attempt }) => [door_id, attempt]), [
    ["I-01", 1], ["K-01", 1], ["X-01", 1], ["I-01", 2], ["K-01", 2], ["X-01", 2],
  ]);
  assert.equal(all.every(({ authority }) => authority === "PAID_SALE"), true);
  for (const row of all.filter(({ attempt }) => attempt === 2)) {
    const expected = `cmd_${crypto.createHash("sha256").update([saleId, row.sale_item_id, "2"].join("\u001f")).digest("hex").slice(0, 40)}`;
    assert.equal(row.command_id, expected);
  }
  assert.throws(() => rig.store.run(`INSERT INTO command_intent(command_id,sale_id,sale_item_id,door_id,controller_channel,mapping_version,attempt,authority,state,created_at) VALUES('third',?,?,?,?,?,3,'PAID_SALE','COMMAND_INTENT_RECORDED',?)`, saleId, all[0].sale_item_id, "I-01", 3, "1", rig.clock.now().toISOString()), /CHECK constraint/i);
  rig.store.close();
});

test("unknown controller effects never auto-repeat, including across recovery", async () => {
  const rig = await createRig();
  rig.controller.script({ fault: "DISCONNECT" });
  const saleId = await authorize(rig, ["X-01"]);
  await rig.machine.drainCommands();
  await rig.machine.initialize();
  const commands = rig.store.all(`SELECT attempt,state FROM command_intent WHERE sale_id=?`, saleId);
  assert.deepEqual(commands, [{ attempt: 1, state: "SENT_UNKNOWN" }]);
  assert.equal(rig.controller.receipts.length, 1);
  rig.store.close();
});

test("an unpaid wrong-door observation halts automation before any later paid command", async () => {
  const rig = await createRig();
  rig.controller.script({ fault: "WRONG_DOOR", observedDoorId: "N-25" }, { fault: "ACK" }, { fault: "ACK" });
  const saleId = await authorize(rig, ["X-01", "K-01", "I-01"]);
  assert.equal(rig.controller.receipts.length, 1);
  assert.equal(rig.controller.receipts[0].observedDoorId, "N-25");
  assert.deepEqual(rig.store.one(`SELECT automation_halted,recovery_required FROM machine_meta WHERE singleton=1`), { automation_halted: 1, recovery_required: 1 });
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE sale_id=? AND state='COMMAND_INTENT_RECORDED'`, saleId).count, 2);
  assert.equal(rig.store.one(`SELECT COUNT(*) AS count FROM machine_event WHERE type='CRITICAL_WRONG_DOOR_OBSERVED'`).count, 1);
  await rig.machine.drainCommands();
  assert.equal(rig.controller.receipts.length, 1);
  rig.store.close();
});

test("controller implementation remains explicitly simulator-only with no guessed hardware protocol", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/controller-simulator.ts"), "utf8");
  assert.match(source, /never opens or addresses physical hardware/i);
  assert.doesNotMatch(source, /node:serialport|from ["']serialport["']|COM\d|baudRate|checksum|USB VID|USB PID/i);
});
