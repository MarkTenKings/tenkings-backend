import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaSpeedsterPreparationStore } from "../lib/server/speedsterPreparationStore";
import { adoptSpeedsterPreparation, beginSpeedsterPreparation, claimSpeedsterPreparationDispatch, freezeSpeedsterPreparationCapture, preflightSpeedsterPreparationCapture, type PreparationStore } from "../lib/server/speedsterPreparationAuthority";
import { FixturePreparationStorage, fixturePreparationBody, fixturePreparationRequest } from "../tests/fixtures/speedsterPreparation";
import { preparationHash } from "../lib/server/speedsterPreparationIntegrity";
import { preparedCaptureIdentity, preparedCaptureReceiptEnv, preparedCaptureSide } from "../tests/fixtures/speedsterPreparedCapture";
import { persistPreparedSpeedsterCaptureTransaction, savePreparedSpeedsterSessionCapture, validateSpeedsterSubmittedMapBinding } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]";
import { resolvePersistedSpeedsterPreparationCapture } from "../lib/server/speedsterPreparationCaptureEvidence";
import { loadLockedEffectiveSpeedsterMapRevision, parseSpeedsterMapSourceSession, saveSpeedsterCardTypeMapRevision, speedsterMapMatchKeyHash } from "../lib/server/speedsterCardTypeMaps";
import { speedsterFamilyCardTypeMapKey } from "../lib/ai-grader-v2/card-type-map-contracts";
import { verifySpeedsterColorGeometryReceipt } from "../lib/server/speedsterColorGeometryAuthority";

const nonce = process.env.SPEEDSTER_PREPARATION_FIXTURE_NONCE;
const data = process.env.SPEEDSTER_PREPARATION_FIXTURE_DATA;
assert(nonce && /^[a-f0-9]{20}$/.test(nonce) && data?.startsWith("/private/tmp/atlas-preparation-db-"), "Fresh fixture sentinel is required");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "preparation_fixture");
assert.equal(url.pathname, `/preparation_fixture_${nonce}`);
const database = new PrismaClient();
let checks = 0;

async function validate() {
  const identity = await database.$queryRaw<Array<{ data: string; nonce: string; address: string }>>(Prisma.sql`
    SELECT current_setting('data_directory') AS data, current_setting('listen_addresses') AS address, nonce FROM "PreparationFixtureSentinel"
  `);
  assert.deepEqual(identity, [{ data, nonce, address: "127.0.0.1" }]);
  const store = createPrismaSpeedsterPreparationStore(database);
  const scope = { sessionId: `fixture-${randomUUID()}`, createdByUserId: "preparation-fixture-user", side: "FRONT" as const };
  await database.aiGraderV2Session.create({ data: {
    id: scope.sessionId, createdByUserId: scope.createdByUserId, cardProfile: "SPORTS", ruleVersion: "fixture-only",
    identity: preparedCaptureIdentity, capture: {}, reviewedDefects: [], gradeReport: {},
  } });
  const request = fixturePreparationRequest(scope);
  const begun = await Promise.all([beginSpeedsterPreparation(request, store), beginSpeedsterPreparation(request, store)]);
  assert.equal(begun.filter((result) => result.created).length, 1);
  assert.equal(await database.aiGraderV2PreparationAttempt.count(), 1);
  checks++;
  const first = begun[0].attempt;
  const claims = await Promise.all([claimSpeedsterPreparationDispatch(scope, first.id, 1, store), claimSpeedsterPreparationDispatch(scope, first.id, 1, store)]);
  assert.equal(claims.filter((result) => result.claimed).length, 1);
  const claimed = claims.find((result) => result.claimed)!.attempt;
  checks++;
  const body = fixturePreparationBody(claimed);

  // A manifest inserted without its terminal/head mutations must roll back at COMMIT.
  await assert.rejects(store.transaction(scope, async (tx) => {
    await tx.insertManifest({
      id: randomUUID(), sessionId: scope.sessionId, createdByUserId: scope.createdByUserId, side: scope.side, sideRevision: 1,
      attemptId: first.id, manifestSha256: preparationHash(body), body, createdAt: new Date(),
    });
  }), /atomically/);
  assert.equal(await database.aiGraderV2PreparationManifest.count(), 0);
  checks++;

  const adoption = await Promise.allSettled([
    adoptSpeedsterPreparation(body, claimed.dispatchClaimId!, store),
    adoptSpeedsterPreparation(fixturePreparationBody(claimed, "two"), claimed.dispatchClaimId!, store),
  ]);
  assert.equal(adoption.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await database.aiGraderV2PreparationManifest.count(), 1);
  const stored = (await store.read(scope)).manifests.FRONT!;
  assert.equal(preparationHash(stored.body), stored.manifestSha256, "exact decimal geometry must survive persistence");
  const jsonbRead = await database.aiGraderV2PreparationManifest.findUniqueOrThrow({ where: { id: stored.id } });
  console.log(`PREPARATION_EXACT_CANONICAL_JSON_PASS projectionHashMatches=${preparationHash(jsonbRead.body) === stored.manifestSha256}`);
  assert.deepEqual(await adoptSpeedsterPreparation(stored.body, claimed.dispatchClaimId!, store), stored);
  checks++;

  for (const mutate of [
    () => database.aiGraderV2PreparationAttempt.update({ where: { id: first.id }, data: { input: { forged: true } } }),
    () => database.aiGraderV2PreparationAttempt.update({ where: { id: first.id }, data: { dispatchClaimId: randomUUID() } }),
    () => database.aiGraderV2PreparationAttempt.update({ where: { id: first.id }, data: { terminalOutcome: "FAILED" } }),
    () => database.aiGraderV2PreparationManifest.update({ where: { id: stored.id }, data: { body: { forged: true } } }),
    () => database.aiGraderV2PreparationManifest.delete({ where: { id: stored.id } }),
    () => database.aiGraderV2PreparationHead.delete({ where: { sessionId_side: { sessionId: scope.sessionId, side: scope.side } } }),
    () => database.$executeRawUnsafe('TRUNCATE "AiGraderV2PreparationManifest" CASCADE'),
  ]) {
    await assert.rejects(mutate());
    checks++;
  }
  assert.deepEqual((await store.read(scope)).manifests.FRONT, stored);

  const secondRequest = { ...request, expected: { sideRevision: 1, attemptId: first.id }, idempotencyKey: randomUUID() };
  const second = await beginSpeedsterPreparation(secondRequest, store);
  assert.equal((await beginSpeedsterPreparation(request, store)).state, "SUPERSEDED");
  await assert.rejects(beginSpeedsterPreparation({ ...request, idempotencyKey: randomUUID() }, store), /head changed/);
  assert.equal((await store.read(scope)).heads.FRONT?.activeAttemptId, second.attempt.id);
  checks++;

  const secondClaim = await claimSpeedsterPreparationDispatch(scope, second.attempt.id, 2, store);
  const secondBody = fixturePreparationBody(secondClaim.attempt);
  const thirdRequest = { ...request, expected: { sideRevision: 2, attemptId: second.attempt.id }, idempotencyKey: randomUUID() };
  const third = await beginSpeedsterPreparation(thirdRequest, store);
  await assert.rejects(adoptSpeedsterPreparation(secondBody, secondClaim.attempt.dispatchClaimId!, store), /superseded/);
  assert.equal(await database.aiGraderV2PreparationManifest.count(), 1);
  checks++;

  const auditFailStore: PreparationStore = { ...store, transaction: (owner, work) => store.transaction(owner, (tx) => work({ ...tx, audit: async () => { throw new Error("fixture audit failure"); } })) };
  await assert.rejects(beginSpeedsterPreparation({ ...request, expected: { sideRevision: 3, attemptId: third.attempt.id }, idempotencyKey: randomUUID() }, auditFailStore), /fixture audit failure/);
  assert.equal((await store.read(scope)).heads.FRONT?.sideRevision, 3);
  assert.equal(await database.aiGraderV2PreparationAttempt.count(), 3);
  checks++;

  const backScope = { ...scope, side: "BACK" as const };
  const back = await beginSpeedsterPreparation(fixturePreparationRequest(backScope), store);
  const thirdClaim = await claimSpeedsterPreparationDispatch(scope, third.attempt.id, 3, store);
  const backClaim = await claimSpeedsterPreparationDispatch(backScope, back.attempt.id, 1, store);
  const frontBody = fixturePreparationBody(thirdClaim.attempt);
  const backBody = fixturePreparationBody(backClaim.attempt);
  await Promise.all([adoptSpeedsterPreparation(frontBody, thirdClaim.attempt.dispatchClaimId!, store), adoptSpeedsterPreparation(backBody, backClaim.attempt.dispatchClaimId!, store)]);
  const storage = new FixturePreparationStorage();
  storage.installBody(frontBody);
  storage.installBody(backBody);
  const preflight = await preflightSpeedsterPreparationCapture({ owner: scope, store, storage, validate: async () => ({ receiptHashes: ["front-physical", "front-printed", "back-physical", "back-printed"], mapAuthorityHash: "fixture-map" }) });
  await database.aiGraderV2Session.update({ where: { id: scope.sessionId }, data: { capture: { mapAuthority: "changed" } } });
  let persisted = false;
  await assert.rejects(freezeSpeedsterPreparationCapture({ preflight, store, recheckAndPersist: async () => { persisted = true; } }), /changed after preflight/);
  assert.equal(persisted, false);
  checks++;
  const pair = (await store.read(scope)).manifests;
  const capture = { cornerShape: "SQUARE", front: preparedCaptureSide(pair.FRONT!), back: preparedCaptureSide(pair.BACK!) };
  const captureDeps: Parameters<typeof savePreparedSpeedsterSessionCapture>[0] = {
    preparationStore: store, preparationStorage: storage, loadLockedMap: loadLockedEffectiveSpeedsterMapRevision,
    persistPreparedCapture: persistPreparedSpeedsterCaptureTransaction,
    findSession: (id, createdByUserId) => database.aiGraderV2Session.findFirst({ where: { id, createdByUserId } }),
    updateSession: async () => { throw new Error("Legacy write cannot run"); },
    verifyColorGeometryReceipt: (receipt, binding) => verifySpeedsterColorGeometryReceipt(receipt, binding, { env: preparedCaptureReceiptEnv }),
    validateMapBinding: (session, binding, input) => validateSpeedsterSubmittedMapBinding(session, binding, input, {
      loadActiveMap: async () => null, hashEvidence: async () => { throw new Error("NO_MAP has no external evidence"); },
    }),
  };
  const captureAuditFailStore: typeof store = { ...store, transaction: (owner, work) => store.transaction(owner, (tx) => work({
    ...tx, audit: async () => { throw new Error("fixture capture audit failure"); },
  })) };
  await assert.rejects(savePreparedSpeedsterSessionCapture({ ...captureDeps, preparationStore: captureAuditFailStore }, scope, capture, undefined), /fixture capture audit failure/);
  assert.equal((await store.read(scope)).session.workflowState, "DRAFT");
  assert.equal(await database.aiGraderV2ColorGeometryEvidence.count({ where: { sessionId: scope.sessionId } }), 0);
  assert.equal(await database.aiGraderV2InstrumentationEvent.count({ where: { sessionId: scope.sessionId, eventType: "CARD_MAP_NOT_APPLIED" } }), 0);
  checks++;
  await savePreparedSpeedsterSessionCapture(captureDeps, scope, capture, undefined);
  const captured = await database.aiGraderV2Session.findUniqueOrThrow({ where: { id: scope.sessionId } });
  const resolved = resolvePersistedSpeedsterPreparationCapture(captured);
  const source = parseSpeedsterMapSourceSession(resolved);
  assert.deepEqual(source.front.transform, frontBody.transform);
  assert.deepEqual(source.front.sourceCorners, frontBody.input.physicalQuad);
  assert.equal(await database.aiGraderV2ColorGeometryEvidence.count({ where: { sessionId: scope.sessionId } }), 4);
  assert.equal(await database.aiGraderV2InstrumentationEvent.count({ where: { sessionId: scope.sessionId, eventType: "CARD_MAP_NOT_APPLIED" } }), 1);
  console.log("PREPARATION_ACTUAL_CAPTURE_CANONICAL_COLOR_AUDIT_PASS");
  assert.equal((await database.aiGraderV2Session.findUniqueOrThrow({ where: { id: scope.sessionId } })).workflowState, "CAPTURED");
  assert.equal(await database.aiGraderV2InstrumentationEvent.count({ where: { eventType: "PREPARATION_CAPTURE_FROZEN" } }), 1);
  await assert.rejects(beginSpeedsterPreparation({ ...thirdRequest, expected: { sideRevision: 3, attemptId: third.attempt.id }, idempotencyKey: randomUUID() }, store), /DRAFT/);
  checks++;
  // Exercise the actual captured-source FAMILY writer and capture's map reader
  // with the reader holding FAMILY before the writer can proceed to EXACT.
  let releaseFamily!: () => void;
  const release = new Promise<void>((resolve) => { releaseFamily = resolve; });
  let familyLocked!: () => void;
  const ready = new Promise<void>((resolve) => { familyLocked = resolve; });
  let writerAtFamily!: () => void;
  const writerReady = new Promise<void>((resolve) => { writerAtFamily = resolve; });
  let readerLocks = 0;
  const reader = database.$transaction(async (tx) => {
    const instrumented = new Proxy(tx, { get(target, key) {
      if (key === "$executeRaw") return async (...args: Parameters<typeof tx.$executeRaw>) => {
        const result = await tx.$executeRaw(...args);
        if (++readerLocks === 1) { familyLocked(); await release; }
        return result;
      };
      return Reflect.get(target, key);
    } });
    assert.equal(await loadLockedEffectiveSpeedsterMapRevision(instrumented, source), null);
  }, { timeout: 10_000 });
  await ready;
  const quad = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }] as const;
  const training = { designBoundary: { kind: "QUAD" as const, points: quad },
    anchors: quad.map((point, i) => ({ id: `a${i + 1}`, label: `Anchor ${i + 1}`, point })),
    zones: [{ id: "name", label: "Synthetic print", semanticType: "PRINT_TEXT" as const, polygon: quad }] };
  const writer = saveSpeedsterCardTypeMapRevision({ source, authorAdminId: scope.createdByUserId, scope: "FAMILY", front: training, back: training,
    hashEvidence: async (key) => key === source.front.inspectionStorageKey ? frontBody.artifacts.INSPECTION.sha256 : backBody.artifacts.INSPECTION.sha256,
    transaction: (work) => database.$transaction(async (tx) => {
      let locks = 0;
      return work(new Proxy(tx, { get(target, key) {
        if (key === "$executeRaw") return (...args: Parameters<typeof tx.$executeRaw>) => {
          if (++locks === 1) {
            assert.equal(args[1], `speedster-map:${speedsterMapMatchKeyHash(speedsterFamilyCardTypeMapKey(source.cardProfile, source.identity))}`,
              "Actual captured-source publisher must request FAMILY before EXACT");
            writerAtFamily();
          }
          return tx.$executeRaw(...args);
        };
        return Reflect.get(target, key);
      } }));
    }, { timeout: 10_000 }),
  });
  // Assert the actual first writer key, then verify concurrent completion.
  // This does not claim to observe a blocked pg_locks row.
  try { await Promise.race([writerReady, writer.then(() => { throw new Error("Writer completed before its lock was observed"); })]); }
  finally { releaseFamily(); }
  const [, published] = await Promise.all([reader, writer]);
  assert.equal(readerLocks, 2);
  const repinned = resolvePersistedSpeedsterPreparationCapture(await database.aiGraderV2Session.findUniqueOrThrow({ where: { id: scope.sessionId } }));
  assert.equal(repinned.mapRevisionId, published.revision.revisionId);
  assert.equal((repinned.mapRegistration as Record<string, any>).front.mapRevisionId, published.revision.revisionId);
  assert.deepEqual(parseSpeedsterMapSourceSession(repinned).front.transform, source.front.transform);
  // A preflight that saw NO_MAP cannot commit after this publication.
  const staleScope = { ...scope, sessionId: `fixture-${randomUUID()}` };
  await database.aiGraderV2Session.create({ data: { id: staleScope.sessionId, createdByUserId: scope.createdByUserId,
    cardProfile: "SPORTS", ruleVersion: "fixture-only", identity: preparedCaptureIdentity, capture: {}, reviewedDefects: [], gradeReport: {} } });
  for (const side of ["FRONT", "BACK"] as const) {
    const sideScope = { ...staleScope, side };
    const attempt = await beginSpeedsterPreparation(fixturePreparationRequest(sideScope), store);
    const claim = await claimSpeedsterPreparationDispatch(sideScope, attempt.attempt.id, 1, store);
    const prepared = fixturePreparationBody(claim.attempt);
    await adoptSpeedsterPreparation(prepared, claim.attempt.dispatchClaimId!, store);
    storage.installBody(prepared);
  }
  const stalePair = (await store.read(staleScope)).manifests;
  await assert.rejects(savePreparedSpeedsterSessionCapture(captureDeps, staleScope, {
    cornerShape: "SQUARE", front: preparedCaptureSide(stalePair.FRONT!), back: preparedCaptureSide(stalePair.BACK!),
  }, undefined), /Card Map selection changed/);
  assert.equal(await database.aiGraderV2ColorGeometryEvidence.count({ where: { sessionId: staleScope.sessionId } }), 0);
  assert.equal((await store.read(staleScope)).session.workflowState, "DRAFT");
  console.log("PREPARATION_ACTUAL_FAMILY_WRITER_CAPTURE_LOCK_ORDER_AND_STALE_MAP_PASS");
  checks++;
  const constraints = await database.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) FROM pg_constraint WHERE conname IN ('PreparationHead_activeAttempt_fkey', 'PreparationHead_adoptedManifest_fkey', 'PreparationManifest_scopedAttempt_key', 'PreparationManifest_scopedIdentity_key')`);
  // Prisma emits unique indexes rather than named unique constraints; verify FKs here.
  assert.equal(Number(constraints[0].count), 2);
  console.log(`PREPARATION_POSTGRES_CONCURRENCY_AND_GUARDS_PASS ${checks} checks`);
}

validate().finally(() => database.$disconnect()).catch((error) => { console.error(error); process.exitCode = 1; });
