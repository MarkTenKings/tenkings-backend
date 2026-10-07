import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { adoptSpeedsterPreparation, beginSpeedsterPreparation, claimSpeedsterPreparationDispatch, failSpeedsterPreparation, freezeSpeedsterPreparationCapture, preflightSpeedsterPreparationCapture } from "../lib/server/speedsterPreparationAuthority";
import { FixturePreparationStorage, FixturePreparationStore, fixturePreparationBody, fixturePreparationRequest, fixturePreparationScope } from "./fixtures/speedsterPreparation";

async function dispatched(store: FixturePreparationStore, request = fixturePreparationRequest()) {
  const begun = await beginSpeedsterPreparation(request, store);
  const claim = await claimSpeedsterPreparationDispatch(request.scope, begun.attempt.id, begun.attempt.sideRevision, store);
  return { request, ...claim, body: fixturePreparationBody(claim.attempt) };
}

test("preparation: concurrent begin and dispatch retries create one attempt and one claim", async () => {
  const store = new FixturePreparationStore();
  const request = fixturePreparationRequest();
  const begun = await Promise.all([beginSpeedsterPreparation(request, store), beginSpeedsterPreparation(request, store)]);
  assert.equal(begun.filter((entry) => entry.created).length, 1);
  assert.equal(store.attempts.size, 1);
  const attempt = begun[0].attempt;
  const claimed = await Promise.all([claimSpeedsterPreparationDispatch(request.scope, attempt.id, 1, store), claimSpeedsterPreparationDispatch(request.scope, attempt.id, 1, store)]);
  assert.equal(claimed.filter((entry) => entry.claimed).length, 1);
  assert.equal((await beginSpeedsterPreparation(request, store)).state, "RUNNING_OR_UNRESOLVED");
  assert.equal(store.events.filter((event) => event.eventType === "PREPARATION_DISPATCH_CLAIMED").length, 1);
});

test("preparation: changed idempotent input and stale begins cannot supersede current work", async () => {
  const store = new FixturePreparationStore();
  const original = await dispatched(store);
  await assert.rejects(beginSpeedsterPreparation({ ...original.request, input: { ...original.request.input, matColor: "WHITE" } }, store), /different input/);
  await assert.rejects(beginSpeedsterPreparation({ ...original.request, idempotencyKey: randomUUID() }, store), /head changed/);
  assert.equal(store.heads.FRONT?.activeAttemptId, original.attempt.id);
});

test("preparation: late A cannot adopt after B; retrying A never reactivates it", async () => {
  const store = new FixturePreparationStore();
  const a = await dispatched(store);
  const b = await dispatched(store, { ...a.request, expected: { sideRevision: 1, attemptId: a.attempt.id }, idempotencyKey: randomUUID() });
  const accepted = await adoptSpeedsterPreparation(b.body, b.attempt.dispatchClaimId!, store);
  await assert.rejects(adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store), /superseded/);
  assert.equal((await beginSpeedsterPreparation(a.request, store)).state, "SUPERSEDED");
  assert.equal(store.heads.FRONT?.adoptedManifestId, accepted.id);
});

test("preparation: response-loss adoption reconciliation returns original immutable manifest", async () => {
  const store = new FixturePreparationStore();
  const a = await dispatched(store);
  const [first, second] = await Promise.all([adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store), adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store)]);
  assert.deepEqual(first, second);
  await dispatched(store, { ...a.request, expected: { sideRevision: 1, attemptId: a.attempt.id }, idempotencyKey: randomUUID() });
  assert.deepEqual(await adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store), first);
  store.session = { ...store.session, workflowState: "CAPTURED" };
  assert.deepEqual(await adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store), first);
  assert.equal(store.events.filter((event) => event.eventType === "PREPARATION_ADOPTED").length, 1);
});

test("preparation: concurrent different valid outputs adopt at most one manifest", async () => {
  const store = new FixturePreparationStore();
  const a = await dispatched(store);
  const results = await Promise.allSettled([adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store), adoptSpeedsterPreparation(fixturePreparationBody(a.attempt, "two"), a.attempt.dispatchClaimId!, store)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(store.manifests.size, 1);
});

test("preparation: wrong dispatch claim, source binding and cross-session replay fail", async () => {
  const store = new FixturePreparationStore();
  const a = await dispatched(store);
  await assert.rejects(adoptSpeedsterPreparation(a.body, randomUUID(), store), /dispatched input/);
  await assert.rejects(adoptSpeedsterPreparation({ ...a.body, input: { ...a.body.input, preparationIdentity: { ...a.body.input.preparationIdentity, buildId: "101-1" } } }, a.attempt.dispatchClaimId!, store), /dispatched input/);
  await assert.rejects(adoptSpeedsterPreparation({ ...a.body, sessionId: "another-session" }, a.attempt.dispatchClaimId!, store));
  await assert.rejects(adoptSpeedsterPreparation({ ...a.body, side: "BACK" }, a.attempt.dispatchClaimId!, store));
  assert.equal(store.manifests.size, 0);
});

test("preparation: failed newer attempt preserves previous evidence without restoring its head", async () => {
  const store = new FixturePreparationStore();
  const a = await dispatched(store);
  const accepted = await adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store);
  const b = await dispatched(store, { ...a.request, expected: { sideRevision: 1, attemptId: a.attempt.id }, idempotencyKey: randomUUID() });
  await failSpeedsterPreparation(b.request.scope, b.attempt.id, b.attempt.dispatchClaimId!, "INVALID_EVIDENCE", store);
  assert.equal(store.heads.FRONT?.activeAttemptId, b.attempt.id);
  assert.equal(store.heads.FRONT?.adoptedManifestId, null);
  assert.ok(store.manifests.has(accepted.id));
  assert.equal((await claimSpeedsterPreparationDispatch(b.request.scope, b.attempt.id, 2, store)).claimed, false);
  await assert.rejects(adoptSpeedsterPreparation(b.body, b.attempt.dispatchClaimId!, store), /terminal/);
});

test("preparation: audit failure rolls back attempt, head and terminal adoption", async () => {
  const store = new FixturePreparationStore();
  store.failAudit = true;
  await assert.rejects(beginSpeedsterPreparation(fixturePreparationRequest(), store), /audit failure/);
  assert.equal(store.attempts.size, 0);
  assert.deepEqual(store.heads, {});
  store.failAudit = false;
  const a = await dispatched(store);
  store.failAudit = true;
  await assert.rejects(adoptSpeedsterPreparation(a.body, a.attempt.dispatchClaimId!, store), /audit failure/);
  assert.equal(store.manifests.size, 0);
  assert.equal(store.attempts.get(a.attempt.id)?.terminalOutcome, null);
});

async function pairFixture() {
  const store = new FixturePreparationStore();
  const storage = new FixturePreparationStorage();
  const sides = await Promise.all([dispatched(store), dispatched(store, fixturePreparationRequest({ ...fixturePreparationScope, side: "BACK" }))]);
  for (const side of sides) {
    storage.installBody(side.body);
    await adoptSpeedsterPreparation(side.body, side.attempt.dispatchClaimId!, store);
  }
  storage.beforeRead = () => { assert.equal(store.locked, false, "storage must remain outside DB locks"); };
  const preflight = await preflightSpeedsterPreparationCapture({ owner: fixturePreparationScope, store, storage,
    validate: async () => ({ receiptHashes: ["physical-front", "printed-front", "physical-back", "printed-back"], mapAuthority: "map-A", registrationHash: "registration-A" }) });
  return { store, storage, sides, preflight };
}

test("preparation: Front/Back preflight freezes one server-loaded pair with no storage under locks", async () => {
  const { store, preflight } = await pairFixture();
  const result = await freezeSpeedsterPreparationCapture({ preflight, store, recheckAndPersist: async (tx, validation, pair) => {
    assert.ok(store.locked);
    assert.equal(tx.snapshot.session.workflowState, "DRAFT");
    assert.equal(validation.mapAuthority, "map-A");
    store.session = { ...store.session, workflowState: "CAPTURED", capture: { front: pair.FRONT.body, back: pair.BACK.body } };
    return "captured";
  } });
  assert.equal(result, "captured");
  assert.equal(store.events.filter((event) => event.eventType === "PREPARATION_CAPTURE_FROZEN").length, 1);
});

for (const change of ["side", "map", "identity", "workflow", "receipt"] as const) {
  test(`preparation: ${change} changing after preflight prevents capture`, async () => {
    const { store, sides, preflight } = await pairFixture();
    if (change === "side") await beginSpeedsterPreparation({ ...sides[0].request, expected: { sideRevision: 1, attemptId: sides[0].attempt.id }, idempotencyKey: randomUUID() }, store);
    if (change === "map") store.session = { ...store.session, capture: { mapAuthority: "map-B" } };
    if (change === "identity") store.session = { ...store.session, identity: { playerName: "Different fixture" } };
    if (change === "workflow") store.session = { ...store.session, workflowState: "CAPTURED" };
    if (change === "receipt") preflight.validation.receiptHashes[0] = "changed";
    let persisted = false;
    await assert.rejects(freezeSpeedsterPreparationCapture({ preflight, store, recheckAndPersist: async () => { persisted = true; } }));
    assert.equal(persisted, false);
  });
}

test("preparation: capture audit failure rolls back the pair transition", async () => {
  const { store, preflight } = await pairFixture();
  store.failAudit = true;
  await assert.rejects(freezeSpeedsterPreparationCapture({ preflight, store, recheckAndPersist: async () => {
    store.session = { ...store.session, workflowState: "CAPTURED" };
  } }), /audit failure/);
  assert.equal(store.session.workflowState, "DRAFT");
});
