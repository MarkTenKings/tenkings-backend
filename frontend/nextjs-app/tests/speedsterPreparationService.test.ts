import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { prepareSpeedsterSide, readSpeedsterPreparationStatus, loadCurrentSpeedsterPreparation, type SpeedsterPreparationServiceDependencies } from "../lib/server/speedsterPreparationService";
import { authorizeSpeedsterPreparationArtifactRead, resolveSpeedsterPreparationOriginalRead } from "../lib/server/speedsterPreparationReads";
import { createSpeedsterPreparationStatusHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/preparation";
import type { NextApiRequest, NextApiResponse } from "next";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { issueSpeedsterColorGeometryReceipt, verifySpeedsterColorGeometryReceipt } from "../lib/server/speedsterColorGeometryAuthority";
import { FixturePreparationStorage, FixturePreparationStore, fixturePreparationColor, fixturePreparationIdentity, fixturePreparationInput, fixturePreparationScope, fixturePreparationTransform } from "./fixtures/speedsterPreparation";

const receiptEnv = { NODE_ENV: "test" as const, SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY: "s".repeat(64), SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY_ID: "preparation-fixture" };
const images = Promise.all([
  sharp({ create: { width: 800, height: 1000, channels: 3, background: "#bc9e76" } }).jpeg().toBuffer(),
  sharp({ create: { width: 1270, height: 1778, channels: 3, background: "#afa690" } }).webp().toBuffer(),
  sharp({ create: { width: 1350, height: 1858, channels: 3, background: "#4a729d" } }).webp().toBuffer(),
]);

async function fixture() {
  const store = new FixturePreparationStore();
  const storage = new FixturePreparationStorage();
  const [original, rectified, inspection] = await images;
  const input = fixturePreparationInput();
  storage.objects.set(input.source.originalStorageKey, original);
  let calls = 0;
  let receipts = 0;
  const grants: string[] = [];
  const deps: SpeedsterPreparationServiceDependencies = {
    store, storage, approvedRelease: () => fixturePreparationIdentity,
    readUrl: async (key) => `fixture-read:${key}`,
    stagingUpload: async (key) => { assert.ok(key.includes("/prepare-staging/")); grants.push(key); return `fixture-put:${key}`; },
    issueColorReceipt: (binding) => { receipts++; return issueSpeedsterColorGeometryReceipt(binding, { env: receiptEnv }); },
    invokeWorker: async (body) => {
      calls++;
      assert.equal(store.locked, false);
      const binding = body.preparationBinding as Record<string, string>;
      const attempt = store.attempts.get(binding.attemptId)!;
      assert.equal(body.imageUrl, `fixture-read:${attempt.input.source.storageKey}`);
      for (const [role, url] of Object.entries(body.outputUploads as Record<string, string>)) {
        const key = url.slice("fixture-put:".length);
        storage.objects.set(key, Buffer.from(role === "rectified" ? rectified : inspection));
      }
      const { originalStorageKey: _original, originalSha256: _originalHash, storageKey: _snapshotKey, ...source } = attempt.input.source;
      return { ok: true, status: 200, payload: {
        width: 1270, height: 1778, borders: null, detectedBorders: [], colorGeometry: fixturePreparationColor,
        transform: fixturePreparationTransform(attempt.input), inspectionFrame: { width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
        preparationIdentity: fixturePreparationIdentity, preparationEvidence: { ...binding, source },
      } };
    },
  };
  storage.beforeRead = () => { assert.equal(store.locked, false, "no storage reads while session/head locks are held"); };
  const request = { sessionId: fixturePreparationScope.sessionId, side: fixturePreparationScope.side, sourceImageStorageKey: input.source.originalStorageKey,
    corners: input.physicalQuad, matColor: input.matColor, preparationRequest: { idempotencyKey: randomUUID(), expectedHead: { sideRevision: 0, attemptId: null as string | null } } };
  return { store, storage, deps, request, grants, calls: () => calls, receipts: () => receipts };
}

test("preparation service: only staging is granted; response and genuine Color receipt use adopted bytes", async () => {
  const f = await fixture();
  const result = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  assert.equal(f.calls(), 1);
  assert.equal(f.grants.length, 5);
  assert.equal(result.preparationState, "ADOPTED");
  const manifest = f.store.manifests.get(result.preparation.manifestId)!;
  verifySpeedsterColorGeometryReceipt(result.colorGeometryReceipt, {
    operatorAdminId: fixturePreparationScope.createdByUserId, sessionId: fixturePreparationScope.sessionId, side: "FRONT", mode: "PRINTED_FRAME",
    sourceImageStorageKey: manifest.body.input.source.originalStorageKey, sourceImageSha256: manifest.body.input.source.sha256,
    matColor: manifest.body.input.matColor, physicalQuadSha256: manifest.body.input.physicalQuadSha256, result: result.colorGeometry,
  }, { env: receiptEnv });
  assert.equal(result.frozenSourceReadUrl, `fixture-read:${manifest.body.input.source.storageKey}`);
  assert.equal("dispatchClaimId" in result.preparation, false);
});

test("preparation service: lost response reconciliation ignores later alias and staging writes", async () => {
  const f = await fixture();
  const result = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  f.storage.objects.set(f.request.sourceImageStorageKey, Buffer.from("later original B"));
  for (const key of f.grants) f.storage.objects.set(key, Buffer.from("late or repeated worker PUT"));
  f.storage.beforeRead = (key) => { assert.notEqual(key, f.request.sourceImageStorageKey, "retry must not rehash the mutable original alias"); };
  assert.deepEqual(await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps), result);
  assert.equal(f.calls(), 1);
  assert.equal(f.receipts(), 1, "read-only reconciliation preserves the receipt and its original expiry");
  assert.equal(f.grants.length, 5);
});

test("preparation service: two concurrent identical requests dispatch once", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps), prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps)]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(f.calls(), 1);
  assert.equal(f.grants.length, 5);
  assert.equal(f.store.manifests.size, 1);
});

test("preparation service: uncertain transport outcome never triggers another call or new grants", async () => {
  const f = await fixture();
  let invoked = 0;
  const deps = { ...f.deps, invokeWorker: async () => { invoked++; throw new Error("fixture connection lost"); } };
  await assert.rejects(prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, deps), /connection lost/);
  await assert.rejects(prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, deps), /running or unresolved/);
  assert.equal(invoked, 1);
  assert.equal(f.grants.length, 5);
  assert.equal([...f.store.attempts.values()][0].terminalOutcome, null);
});

test("preparation service: old request returns preserved superseded state without reactivation", async () => {
  const f = await fixture();
  const a = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  const next = { ...f.request, preparationRequest: { idempotencyKey: randomUUID(), expectedHead: { sideRevision: 1, attemptId: a.preparation.attemptId } } };
  const b = await prepareSpeedsterSide(next, fixturePreparationScope.createdByUserId, f.deps);
  const old = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  assert.equal(old.preparationState, "SUPERSEDED");
  assert.equal(old.preparation.manifestId, a.preparation.manifestId);
  assert.equal(f.store.heads.FRONT?.adoptedManifestId, b.preparation.manifestId);
  assert.equal(f.calls(), 2);
});

test("preparation service: malformed result cannot restore the previous adoption", async () => {
  const f = await fixture();
  const a = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  const next = { ...f.request, preparationRequest: { idempotencyKey: randomUUID(), expectedHead: { sideRevision: 1, attemptId: a.preparation.attemptId } } };
  await assert.rejects(prepareSpeedsterSide(next, fixturePreparationScope.createdByUserId, { ...f.deps, invokeWorker: async () => ({ ok: true, status: 200, payload: {} }) }));
  assert.equal(f.store.heads.FRONT?.adoptedManifestId, null);
  assert.equal(f.store.attempts.get(f.store.heads.FRONT!.activeAttemptId)?.terminalOutcome, "FAILED");
  assert.ok(f.store.manifests.has(a.preparation.manifestId));
});

test("preparation service: absent approved release fails before source reads, grants, dispatch, or durable mutation", async () => {
  const f = await fixture();
  const unavailable = new HttpError(503, "Fixture reviewed preparation authority is unavailable.");
  let reads = 0, releaseChecks = 0;
  f.storage.beforeRead = () => { reads++; };
  const before = structuredClone({ session: f.store.session, heads: f.store.heads, attempts: f.store.attempts,
    manifests: f.store.manifests, events: f.store.events, objects: f.storage.objects });
  await assert.rejects(prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, { ...f.deps,
    approvedRelease: () => { releaseChecks++; throw unavailable; } }), (error) => error === unavailable && unavailable.statusCode === 503);
  assert.equal(releaseChecks, 1); assert.equal(reads, 0);
  assert.equal(f.storage.writes.length, 0); assert.equal(f.grants.length, 0); assert.equal(f.calls(), 0); assert.equal(f.receipts(), 0);
  assert.deepEqual(structuredClone({ session: f.store.session, heads: f.store.heads, attempts: f.store.attempts,
    manifests: f.store.manifests, events: f.store.events, objects: f.storage.objects }), before);
});

test("preparation service: browser-provided write grants fail before storage/provider work", async () => {
  const f = await fixture();
  let reads = 0;
  f.storage.beforeRead = () => { reads++; };
  await assert.rejects(prepareSpeedsterSide({ ...f.request, outputUploads: { rectified: "attacker" } }, fixturePreparationScope.createdByUserId, f.deps), /exact request/);
  assert.equal(reads, 0);
  assert.equal(f.storage.writes.length, 0);
  assert.equal(f.grants.length, 0);
  assert.equal(f.calls(), 0);
});

test("preparation reads: status preserves original receipt, dispatch count, head and immutable history", async () => {
  const f = await fixture();
  const prepared = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  const before = structuredClone({ attempts: f.store.attempts, heads: f.store.heads, manifests: f.store.manifests, events: f.store.events });
  const saved = await readSpeedsterPreparationStatus(fixturePreparationScope, f.deps);
  assert.equal(saved.sides.FRONT.adopted.colorGeometryReceipt, prepared.colorGeometryReceipt);
  assert.equal(saved.sides.FRONT.request.idempotencyKey, f.request.preparationRequest.idempotencyKey);
  assert.doesNotMatch(JSON.stringify(saved), /dispatchClaimId|stagingUpload|outputUploads/);
  assert.equal(f.calls(), 1);
  assert.equal(f.receipts(), 1);
  assert.deepEqual({ attempts: f.store.attempts, heads: f.store.heads, manifests: f.store.manifests, events: f.store.events }, before);
});

test("preparation reads: frozen original survives alias overwrite; corrupt evidence cannot receive read authority", async () => {
  const f = await fixture();
  const prepared = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  const manifest = await loadCurrentSpeedsterPreparation(prepared.preparation, fixturePreparationScope, f.store);
  f.storage.objects.set(f.request.sourceImageStorageKey, Buffer.from("different mutable original"));
  assert.equal(await resolveSpeedsterPreparationOriginalRead(fixturePreparationScope, f.request.sourceImageStorageKey, f.store, f.storage.read), manifest.body.input.source.storageKey);
  const key = manifest.body.artifacts.RECTIFIED.storageKey;
  assert.equal(await authorizeSpeedsterPreparationArtifactRead(fixturePreparationScope, key, f.store, f.storage.read), true);
  for (const scope of [{ ...fixturePreparationScope, side: "BACK" as const }, { ...fixturePreparationScope, createdByUserId: "other" }, { ...fixturePreparationScope, sessionId: "other" }]) {
    assert.equal(await authorizeSpeedsterPreparationArtifactRead(scope, key, f.store, f.storage.read), false);
    await assert.rejects(loadCurrentSpeedsterPreparation(prepared.preparation, scope, f.store));
  }
  f.storage.objects.set(key, Buffer.from("corrupt artifact"));
  await assert.rejects(authorizeSpeedsterPreparationArtifactRead(fixturePreparationScope, key, f.store, f.storage.read), /bytes changed/);
  await assert.rejects(readSpeedsterPreparationStatus(fixturePreparationScope, f.deps), /changed|match/);
  assert.equal(f.calls(), 1);
});

test("preparation reads: historical artifact stays readable after supersession without reactivating it", async () => {
  const f = await fixture();
  const first = await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  const next = { ...f.request, preparationRequest: { idempotencyKey: randomUUID(), expectedHead: { sideRevision: first.preparation.sideRevision, attemptId: first.preparation.attemptId } } };
  const second = await prepareSpeedsterSide(next, fixturePreparationScope.createdByUserId, f.deps);
  await assert.rejects(loadCurrentSpeedsterPreparation(first.preparation, fixturePreparationScope, f.store), /superseded/);
  assert.equal(await authorizeSpeedsterPreparationArtifactRead(fixturePreparationScope, first.outputs.RECTIFIED.storageKey, f.store, f.storage.read), true);
  assert.equal(f.store.heads.FRONT?.activeAttemptId, second.preparation.attemptId);
  assert.equal(f.calls(), 2);
});

test("preparation status route allows only authenticated scoped GET and never changes authority", async () => {
  const f = await fixture();
  await prepareSpeedsterSide(f.request, fixturePreparationScope.createdByUserId, f.deps);
  let reads = 0;
  const handler = createSpeedsterPreparationStatusHandler({ requireAdminSession: async () => ({ user: { id: fixturePreparationScope.createdByUserId } }),
    read: async (sessionId, createdByUserId) => { reads++; assert.equal(sessionId, fixturePreparationScope.sessionId); assert.equal(createdByUserId, fixturePreparationScope.createdByUserId); return readSpeedsterPreparationStatus({ sessionId, createdByUserId }, f.deps); } });
  const run = async (method: string, sessionId: unknown) => {
    const state = { status: 0, body: undefined as unknown, cache: "" };
    const res = { setHeader: (name: string, value: string) => { if (name === "Cache-Control") state.cache = value; },
      status: (status: number) => { state.status = status; return res; }, json: (body: unknown) => { state.body = body; return res; } } as unknown as NextApiResponse;
    await handler({ method, query: { sessionId } } as unknown as NextApiRequest, res);
    return state;
  };
  assert.equal((await run("POST", fixturePreparationScope.sessionId)).status, 405);
  assert.equal((await run("GET", [fixturePreparationScope.sessionId])).status, 400);
  assert.equal(reads, 0);
  const good = await run("GET", fixturePreparationScope.sessionId);
  assert.equal(good.status, 200);
  assert.equal(good.cache, "private, no-store");
  assert.equal(reads, 1);
  assert.equal(f.calls(), 1);
});
