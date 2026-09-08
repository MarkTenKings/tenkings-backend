import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beginSpeedsterPreparation, claimSpeedsterPreparationDispatch, adoptSpeedsterPreparation, type PreparationStore } from "../lib/server/speedsterPreparationAuthority";
import { bindSpeedsterPreparationCapture, resolvePersistedSpeedsterPreparationCapture, speedsterPreparationSideAuthority } from "../lib/server/speedsterPreparationCaptureEvidence";
import { savePreparedSpeedsterSessionCapture, validateSpeedsterSubmittedMapBinding } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]";
import { parseSpeedsterMapSourceSession } from "../lib/server/speedsterCardTypeMaps";
import { verifySpeedsterColorGeometryReceipt } from "../lib/server/speedsterColorGeometryAuthority";
import type { PrismaPreparationTransaction } from "../lib/server/speedsterPreparationStore";
import { FixturePreparationStorage, FixturePreparationStore, fixturePreparationBody, fixturePreparationRequest, fixturePreparationScope } from "./fixtures/speedsterPreparation";
import { preparedCaptureIdentity, preparedCaptureReceiptEnv, preparedCaptureSide } from "./fixtures/speedsterPreparedCapture";

async function fixture() {
  const store = new FixturePreparationStore();
  store.session = { ...store.session, identity: preparedCaptureIdentity };
  const storage = new FixturePreparationStorage();
  for (const side of ["FRONT", "BACK"] as const) {
    const scope = { ...fixturePreparationScope, side };
    const begun = await beginSpeedsterPreparation(fixturePreparationRequest(scope), store);
    const claimed = await claimSpeedsterPreparationDispatch(scope, begun.attempt.id, 1, store);
    const body = fixturePreparationBody(claimed.attempt);
    await adoptSpeedsterPreparation(body, claimed.attempt.dispatchClaimId!, store);
    storage.installBody(body);
  }
  const pair = (await store.read(fixturePreparationScope)).manifests as Required<Awaited<ReturnType<typeof store.read>>["manifests"]>;
  const capture = { cornerShape: "SQUARE", front: preparedCaptureSide(pair.FRONT), back: preparedCaptureSide(pair.BACK) };
  const database = { $executeRaw: async () => 1 } as unknown as Prisma.TransactionClient;
  const adapter: PreparationStore<PrismaPreparationTransaction> = { read: store.read,
    transaction: (owner, work) => store.transaction(owner, (tx) => work({ ...tx, database })) };
  let rows = 0;
  let now = Date.now();
  const deps: Parameters<typeof savePreparedSpeedsterSessionCapture>[0] = {
    preparationStore: adapter, preparationStorage: storage, requireAdminSession: async () => ({ user: { id: store.session.createdByUserId } }),
    findSession: async () => store.session, updateSession: async () => { throw new Error("legacy save must not run"); },
    validateMapBinding: (session, binding, input) => validateSpeedsterSubmittedMapBinding(session, binding, input, {
      loadActiveMap: async () => { assert.equal(store.locked, false); return null; }, hashEvidence: async () => { throw new Error("NO_MAP has no external map evidence"); },
    }),
    verifyColorGeometryReceipt: (receipt, binding) => verifySpeedsterColorGeometryReceipt(receipt, binding, { env: preparedCaptureReceiptEnv, now }),
    loadLockedMap: async () => { assert.equal(store.locked, true); return null; },
    persistPreparedCapture: async (_tx, data, evidence) => {
      assert.equal(store.locked, true);
      rows = evidence.length;
      store.session = { ...store.session, ...data } as typeof store.session;
      return store.session;
    },
  };
  storage.beforeRead = () => { assert.equal(store.locked, false, "object reads must precede locks"); };
  return { store, storage, capture, pair, deps, rows: () => rows, expire: () => { now += 25 * 60 * 60 * 1000; },
    save: () => savePreparedSpeedsterSessionCapture(deps, fixturePreparationScope, capture, undefined) };
}

test("prepared capture: actual save boundary uses frozen bytes, exact canonical geometry, and server centering", async () => {
  const f = await fixture();
  for (const side of ["FRONT", "BACK"] as const) f.storage.objects.set(f.pair[side].body.input.source.originalStorageKey, Buffer.from("alias was replaced after preparation"));
  const saved = await f.save();
  assert.equal(saved?.workflowState, "CAPTURED");
  assert.equal(f.rows(), 4);
  assert.equal(f.store.events.at(-1)?.eventType, "PREPARATION_CAPTURE_FROZEN");
  const resolved = resolvePersistedSpeedsterPreparationCapture(f.store.session);
  const source = parseSpeedsterMapSourceSession(resolved);
  assert.deepEqual(source.front.sourceCorners, f.pair.FRONT.body.input.physicalQuad);
  assert.deepEqual(source.front.transform, f.pair.FRONT.body.transform);
  assert(source.front.centeringBorders.leftMm > 0, "browser zero border values are ignored");
  assert.throws(() => parseSpeedsterMapSourceSession({ ...f.store.session, capture: f.capture }), /bound/);
});

test("prepared capture: canonical reads retain report keys and current map repins while overriding numeric projection drift", async () => {
  const f = await fixture();
  await f.save();
  const stored = structuredClone(f.store.session.capture) as typeof f.capture;
  stored.front.sourceCorners = stored.front.sourceCorners.map((point) => ({ x: point.x + Number.EPSILON, y: point.y })) as unknown as typeof stored.front.sourceCorners;
  stored.front.transform = stored.front.transform.map((number) => number + Number.EPSILON);
  Object.assign(stored.front, { reportStorageKey: "later-report-key" });
  const read = resolvePersistedSpeedsterPreparationCapture({ ...f.store.session, capture: stored, mapRevisionId: "later-map", mapRegistration: { later: true } });
  const front = (read.capture as typeof stored).front;
  assert.deepEqual(front.sourceCorners, f.pair.FRONT.body.input.physicalQuad);
  assert.deepEqual(front.transform, f.pair.FRONT.body.transform);
  assert.equal((front as unknown as Record<string, unknown>).reportStorageKey, "later-report-key");
  assert.deepEqual(read.mapRegistration, { later: true });
  assert.equal(speedsterPreparationSideAuthority(front)?.attemptId, f.pair.FRONT.attemptId);
});

for (const field of ["preparation", "sourceCorners", "rectifiedStorageKey", "inspectionFrame", "transform", "matColor", "sourceReceipt"] as const) {
  test(`prepared capture: ${field} substitution cannot save or reactivate evidence`, async () => {
    const f = await fixture();
    if (field === "preparation") f.capture.front.preparation = { ...f.capture.front.preparation, manifestId: randomUUID() };
    if (field === "sourceCorners") f.capture.front.sourceCorners = f.capture.front.sourceCorners.map((point) => ({ ...point, x: point.x + .01 })) as unknown as typeof f.capture.front.sourceCorners;
    if (field === "rectifiedStorageKey") f.capture.front.rectifiedStorageKey = f.capture.back.rectifiedStorageKey;
    if (field === "inspectionFrame") f.capture.front.inspectionFrame = { ...f.capture.front.inspectionFrame, width: 1270 };
    if (field === "transform") f.capture.front.transform = f.capture.front.transform.map((number) => number + 1);
    if (field === "matColor") f.capture.front.colorGeometryEvidence[0].matColor = "WHITE";
    if (field === "sourceReceipt") f.capture.front.colorGeometryEvidence[0].serverReceipt = f.capture.back.colorGeometryEvidence[0].serverReceipt;
    await assert.rejects(f.save());
    assert.equal(f.store.session.workflowState, "DRAFT");
    assert.equal(f.rows(), 0);
  });
}

test("prepared capture: a new head after storage preflight defeats the save", async () => {
  const f = await fixture();
  let raced = false;
  f.storage.beforeRead = async () => {
    assert.equal(f.store.locked, false);
    if (raced) return;
    raced = true;
    await beginSpeedsterPreparation({ ...fixturePreparationRequest(), expected: { sideRevision: 1, attemptId: f.pair.FRONT.attemptId } }, f.store);
  };
  await assert.rejects(f.save(), /changed after preflight|require adopted preparation/);
  assert.equal(f.rows(), 0);
});

test("prepared capture: receipt expiry while acquiring locks is checked without object reads", async () => {
  const f = await fixture();
  f.deps.loadLockedMap = async () => { f.expire(); return null; };
  await assert.rejects(f.save(), /receipt expired/);
  assert.equal(f.rows(), 0);
});

test("prepared capture: browser canonical envelope and foreign owner cannot grant authority", async () => {
  const f = await fixture();
  assert.throws(() => bindSpeedsterPreparationCapture({ ...f.capture, preparationEvidenceCanonical: "forged" }, f.pair), /Browser/);
  await f.save();
  assert.throws(() => resolvePersistedSpeedsterPreparationCapture({ ...f.store.session, createdByUserId: "other-owner" }), /different authority/);
});
