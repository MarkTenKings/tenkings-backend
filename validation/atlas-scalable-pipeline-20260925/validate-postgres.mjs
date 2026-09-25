import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../packages/atlas-manual-service/scripts/owned-fixture.mjs';
import { PrismaClient } from '../../frontend/atlas-app/.generated/staff-database/index.js';
import { manualGrantSQL } from '../../packages/atlas-manual-service/src/staff-auth.mjs';
import { createMachineStaffBoundary, machineGrantSQL } from '../../packages/atlas-manual-service/src/machine-auth.mjs';
import { createIntakeRepository, intakeGrantSQL, ingestionGrantSQL } from '../../packages/atlas-manual-intake/src/repository.mjs';
import { createIntakeIngestionRepository, createIntakeIngestionWorker } from '../../packages/atlas-manual-intake/src/ingestion.mjs';
import { createManualIntake } from '../../packages/atlas-manual-intake/src/service.mjs';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '../../packages/atlas-photo-runtime/src/index.mjs';
import { document } from '../../packages/atlas-manual-intake/src/contract.mjs';
import { createBatchRepository, recordBatchPreparedPair, batchGrantSQL } from '../../packages/atlas-batch-grading/src/repository.mjs';
import { batchAnalysisActionId } from '../../packages/atlas-batch-grading/src/index.mjs';
import { analysisReceiptGrantSQL } from '../../packages/atlas-defect-analysis/src/repository.mjs';

const output = process.env.ATLAS_SCALABLE_EVIDENCE;
assert(output && resolve(output) === output, 'Supply absolute ATLAS_SCALABLE_EVIDENCE');
await mkdir(output, { recursive: true, mode: 0o700 });
const checks = [], measurements = {}, children = new Set();
const fixture = await createOwnedManualFixture(process.argv.slice(2));
const connection = fixture.connect();
let machineClient, intakeWorker;
const record = name => { checks.push(name); console.log(JSON.stringify({ check: name, status: 'PASS' })); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label, timeout = 30000) => {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) { if (await predicate()) return; await sleep(40); }
  throw new Error(`Timed out: ${label}`);
};
const rows = (sql, ...args) => fixture.admin.$queryRawUnsafe(sql, ...args);
try {
  const role = 'atlas_fixture_scalable', password = randomBytes(24).toString('hex');
  await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  const grants = target => [manualGrantSQL(target), intakeGrantSQL(target), ingestionGrantSQL(target),
    batchGrantSQL(target), analysisReceiptGrantSQL(target), machineGrantSQL(target)].join('\n');
  await fixture.cluster.sql(grants(role) + '\n' + grants('atlas_fixture_manual'), [], fixture.database.name);
  const databaseUrl = new URL(fixture.database.adminUrl);
  databaseUrl.username = role; databaseUrl.password = password; databaseUrl.searchParams.set('schema', 'atlas_manual');
  machineClient = new PrismaClient({ datasources: { db: { url: databaseUrl.href } } });
  const boundary = createMachineStaffBoundary({ boundary: connection.boundary, auth: connection.auth, manualClient: machineClient });
  const intake = createIntakeRepository({ boundary, keyPrefix: 'fixture', maxOriginalBytes: 100000000, pairCommitted: recordBatchPreparedPair, includeIngestionStatus: true });
  const batch = createBatchRepository({ boundary, intakeRepository: intake });
  const boot = await connection.auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await connection.auth.send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'scalable-fixture');
  const verified = await connection.auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'scalable-fixture');
  const owner = await connection.auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  const [identity] = await rows('SELECT "accessVersion" AS version FROM atlas_staff."StaffIdentity" WHERE id=$1::uuid', owner.id);
  const machine = boundary.machineOwner({ ownerId: owner.id, accessVersion: identity.version });
  const pair = async (staff, label) => {
    const { card } = await intake.create(staff, { requestId: randomUUID(), label });
    for (const side of ['FRONT', 'BACK']) {
      const { upload } = await intake.plan(staff, card.cardId, { requestId: randomUUID(), side, expectedVersion: 0, sha256: 'a'.repeat(64), byteCount: 1 });
      const verification = { object: upload.plan.object, sha256: 'a'.repeat(64), byteCount: 1, contentType: 'application/octet-stream' };
      await intake.recordVerification(staff, card.cardId, upload.uploadId, verification);
      await intake.recordSource(staff, card.cardId, upload.uploadId, { verificationHash: document(verification).hash, source: { fixture: true } });
    }
    return (await intake.read(staff, card.cardId)).card;
  };
  const cards = [];
  for (let index = 0; index < 21; index++) cards.push(await pair(owner, `Owned machine capacity fixture ${index}`));
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_manual_connected.batch_grading'))[0].n, 21);
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_manual_connected.batch_request'))[0].n, 0);
  record('second prepared side atomically admits 21 jobs without browser enqueue or batch-request rows');
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET stage='ANALYZE'");
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp()');
  await assert.rejects(connection.auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf));
  assert.equal((await boundary.machineTransaction(machine, ({ principal }) => principal)).canCertify, false);
  await assert.rejects(boundary.machineTransaction({ ...machine }, () => {}), error => error.code === 'MANUAL_MACHINE_AUTH_REQUIRED');
  record('revoked browser session has no authority; separate opaque owner machine handle continues without certification');

  const binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, fixture.config[key]]));
  const launch = () => {
    const child = fork(new URL('./worker-child.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    const state = { child, claims: [], errors: [], exit: null, stderr: '' };
    children.add(state); child.stderr.on('data', bytes => { state.stderr += bytes.toString().slice(0, 1000); });
    child.on('message', event => { if (event.type === 'claim') state.claims.push(event); if (['error', 'fatal'].includes(event.type)) { state.errors.push(event.code); console.log(JSON.stringify({ childError: event.code })); } });
    child.on('exit', (code, signal) => { state.exit = { code, signal }; });
    child.send({ type: 'init', databaseUrl: databaseUrl.href, binding, phoneHashes: [...fixture.config.phoneByHash.keys()] });
    return state;
  };
  const kill = async state => { state.child.kill('SIGKILL'); await until(() => state.exit !== null, 'child process exit'); children.delete(state); };
  const first = launch(), second = launch(), started = performance.now();
  await until(() => first.claims.length + second.claims.length === 20, '20 simultaneous claimed analysis jobs');
  await sleep(250);
  assert.equal(first.claims.length + second.claims.length, 20);
  const originalClaims = [...first.claims, ...second.claims];
  assert.equal(new Set(originalClaims.map(row => row.key)).size, 20);
  const [capacity] = await rows("SELECT count(*) FILTER(WHERE state='RUNNING')::int running,count(*) FILTER(WHERE analysis_reserved)::int reserved,count(*) FILTER(WHERE state='QUEUED')::int queued FROM atlas_manual_connected.batch_grading");
  assert.deepEqual(capacity, { running: 20, reserved: 20, queued: 1 });
  measurements.twentyDispatchAdmissionMs = performance.now() - started;
  assert.deepEqual([...first.errors, ...second.errors], []);
  await kill(first); await kill(second);
  record('two separate OS workers discover browserless persisted jobs; global SQL capacity admits exactly 20 of 21');
  assert.equal((await rows("SELECT count(*)::int n FROM atlas_manual_connected.batch_grading WHERE state='RUNNING'"))[0].n, 20);
  // An owned-fixture clock jump makes crash recovery deterministic; no live
  // claim or production lease is modified by this validation script.
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()-interval '1 second' WHERE state='RUNNING'");
  const recovered = launch();
  await until(() => recovered.claims.length === 20, 'restarted process reclaims persisted capacity');
  const recoveredFirst = recovered.claims.slice();
  assert.deepEqual(recoveredFirst.map(row => row.key).sort(), originalClaims.map(row => row.key).sort());
  for (const claim of recoveredFirst) assert.equal(claim.action, originalClaims.find(row => row.key === claim.key).action);
  for (const claim of recoveredFirst) recovered.child.send({ type: 'release', key: claim.key });
  await until(() => recovered.claims.length === 21, '21st admission after capacity release');
  recovered.child.send({ type: 'release', key: recovered.claims[20].key });
  await until(async () => (await rows("SELECT count(*)::int n FROM atlas_manual_connected.batch_grading WHERE state='REVIEW'"))[0].n === 21, 'all machine proposals await human review');
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_manual.approval'))[0].n, 0);
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_defect_analysis.run'))[0].n, 0);
  assert.deepEqual(recovered.errors, []);
  await kill(recovered);
  record('SIGKILL/restart retains exact action IDs, reclaims expired leases, drains overflow and never creates a human approval or paid run');
  const reviewJob = (await batch.list(machine)).jobs[0];
  await assert.rejects(batch.beginReview(machine, reviewJob.key, { reportHash: 'f'.repeat(64) }), error => error.code === 'MANUAL_CERTIFICATION_REQUIRED');
  record('machine actor cannot begin human review even when its job reaches REVIEW');

  const recovery = await pair(machine, 'Owned exact READY recovery');
  const content = document({ fixture: 'unchanged manual draft' });
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)', recovery.cardId, content.text, content.hash, owner.id);
  const [recoverJob] = await rows('SELECT * FROM atlas_manual_connected.batch_grading WHERE card_id=$1::uuid', recovery.cardId);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='NEEDS_ATTENTION',stage='ANALYZE',code='ECONNRESET',analysis_reserved=true,evidence=$2 WHERE key=$1", recoverJob.key, document({ manualContentHash: content.hash, manualRevision: 1 }).text);
  const compact = document({ fixture: true }), runId = randomUUID(), requestHash = 'b'.repeat(64);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$6,$6,$7,'PREPARED',clock_timestamp()+interval '3 minutes')`, runId, recovery.cardId, recoverJob.analysis_action_id, owner.id, content.hash, compact.text, compact.hash, requestHash);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid", runId);
  const receipt = document({ state: 'READY', responseRef: { fixture: true }, resultRef: { fixture: true }, responseHash: 'c'.repeat(64), providerRequestId: 'owned-fixture', responseId: 'owned-fixture', httpStatus: 200, usage: null, code: null }).text;
  assert.equal((await machineClient.$queryRawUnsafe('SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,$3,$4) saved', runId, requestHash, 'RESPONSE', receipt))[0].saved, true);
  const discovered = await batch.discoverOwners(); assert(discovered.length > 0);
  const reclaimed = await batch.claim(discovered[0], randomUUID(), 20, 20);
  assert.equal(reclaimed.key, recoverJob.key); assert.equal(reclaimed.analysisActionId, recoverJob.analysis_action_id);
  assert.equal(await batch.finish(discovered[0], reclaimed, { kind: 'CONTINUE' }), true);
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_defect_analysis.run WHERE card_id=$1::uuid', recovery.cardId))[0].n, 1);
  record('saved exact READY receipt rescues transport-failed ANALYZE automatically under original action; no replacement paid run is created');
  const reportClaim = await batch.claim(machine, randomUUID(), 20, 20);
  assert.equal(reportClaim.key, recoverJob.key);
  await batch.finish(machine, reportClaim, { kind: 'REVIEW', evidence: { reportHash: 'f'.repeat(64) } });

  const refused = async httpStatus => {
    const card = await pair(machine, `Owned HTTP ${httpStatus} retry fixture`);
    await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)', card.cardId, content.text, content.hash, owner.id);
    const [job] = await rows('SELECT * FROM atlas_manual_connected.batch_grading WHERE card_id=$1::uuid', card.cardId);
    await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='NEEDS_ATTENTION',stage='ANALYZE',code='DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR',analysis_reserved=true,evidence=$2 WHERE key=$1", job.key, document({ manualContentHash: content.hash, manualRevision: 1 }).text);
    const id = randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$6,$6,$7,'PREPARED',clock_timestamp()+interval '3 minutes')`, id, card.cardId, job.analysis_action_id, owner.id, content.hash, compact.text, compact.hash, requestHash);
    await fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid", id);
    const rejected = document({ state: 'REFUSED', responseRef: { fixture: true }, resultRef: null, responseHash: 'c'.repeat(64),
      providerRequestId: 'owned-refusal', responseId: null, httpStatus, usage: null, code: 'DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR' }).text;
    await machineClient.$queryRawUnsafe('SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,$3,$4) saved', id, requestHash, 'RESPONSE', rejected);
    return job;
  };
  const rateLimited = await refused(429), ambiguous = await refused(500);
  const retryClaim = await batch.claim(machine, randomUUID(), 20, 20); assert.equal(retryClaim.key, rateLimited.key);
  assert.equal(await batch.finish(machine, retryClaim, { kind: 'RETRY_ANALYSIS' }), true);
  const [successor] = await rows('SELECT analysis_action_id,analysis_attempt,evidence,EXTRACT(EPOCH FROM available_at-clock_timestamp())::double precision delay FROM atlas_manual_connected.batch_grading WHERE key=$1', retryClaim.key);
  assert.equal(successor.analysis_attempt, 1); assert.notEqual(successor.analysis_action_id, rateLimited.analysis_action_id);
  assert.deepEqual(JSON.parse(successor.evidence).analysisActions, [rateLimited.analysis_action_id]); assert(successor.delay > 28);
  assert.equal(await batch.claim(machine, randomUUID(), 20, 20), null);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='QUEUED' WHERE key=$1", ambiguous.key);
  const ambiguousClaim = await batch.claim(machine, randomUUID(), 20, 20); assert.equal(ambiguousClaim.key, ambiguous.key);
  await assert.rejects(batch.finish(machine, ambiguousClaim, { kind: 'RETRY_ANALYSIS' }), error => error.code === 'BATCH_RATE_LIMIT_RETRY_UNPROVEN');
  await assert.rejects(machineClient.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading
    SET analysis_action_id=$2::uuid,analysis_attempt=1,evidence=$3,available_at=clock_timestamp()+interval '30 seconds'
    WHERE key=$1`, ambiguous.key, batchAnalysisActionId(ambiguous.key, 1),
  document({ manualContentHash: content.hash, manualRevision: 1, analysisActions: [ambiguous.analysis_action_id] }).text),
  error => error.code === 'P2010' && error.meta?.code === 'P0001');
  assert.equal((await rows('SELECT analysis_action_id FROM atlas_manual_connected.batch_grading WHERE key=$1', ambiguous.key))[0].analysis_action_id, ambiguous.analysis_action_id);
  await batch.finish(machine, ambiguousClaim, { kind: 'ATTENTION', code: 'FIXTURE_UNKNOWN_RETAINED' });
  record('exact unaccepted HTTP429 permits one retained deterministic successor with durable 30-second backoff; application and SQL trigger both reject HTTP500 successor');

  const pending = await intake.create(machine, { requestId: randomUUID(), label: 'Owned ingestion crash fence' });
  const plan = await intake.plan(machine, pending.card.cardId, { requestId: randomUUID(), side: 'FRONT', expectedVersion: 0, sha256: 'd'.repeat(64), byteCount: 1 });
  const ingestion = createIntakeIngestionRepository({ boundary, leaseMs: 1000 });
  const lease = await ingestion.claim('VERIFY', 4); assert.equal(lease.uploadId, plan.upload.uploadId);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_intake.ingestion SET lease_until=clock_timestamp()-interval '1 second' WHERE upload_id=$1::uuid", lease.uploadId);
  const replacement = await ingestion.claim('VERIFY', 4); assert.equal(replacement.uploadId, lease.uploadId); assert.notEqual(replacement.claimId, lease.claimId);
  const observed = { object: plan.upload.plan.object, sha256: 'd'.repeat(64), byteCount: 1, contentType: 'application/octet-stream' };
  await assert.rejects(intake.recordVerification(machine, pending.card.cardId, lease.uploadId, observed, { lease }), error => error.code === 'INTAKE_LEASE_LOST');
  await intake.recordVerification(machine, pending.card.cardId, replacement.uploadId, observed, { lease: replacement });
  assert.equal(await ingestion.finish(replacement, { kind: 'CONTINUE' }), true);
  const [stage] = await rows('SELECT stage,state FROM atlas_manual_intake.ingestion WHERE upload_id=$1::uuid', replacement.uploadId);
  assert.deepEqual(stage, { stage: 'PREPARE', state: 'QUEUED' });
  await intake.discard(machine, { requestId: randomUUID(), scope: 'SELECTED', cardIds: [pending.card.cardId] });
  await ingestion.claim('PREPARE', 2);
  assert.equal((await rows('SELECT state FROM atlas_manual_intake.ingestion WHERE upload_id=$1::uuid', replacement.uploadId))[0].state, 'SUPERSEDED');
  record('per-upload trigger survives lost response; expired claim cannot verify; new claim advances stage; deletion reaps pending intake');

  // Real native decoding and filesystem-backed original/artifact ports. No
  // client complete/prepare/enqueue request occurs after these plans exist.
  const sharp = createRequire(new URL('../../packages/atlas-photo-runtime/package.json', import.meta.url))('sharp');
  const bytes = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#476b81' } }).png().toBuffer();
  const digest = value => createHash('sha256').update(value).digest('hex'), originalHash = digest(bytes);
  const auto = await intake.create(machine, { requestId: randomUUID(), label: 'Owned native automatic ingestion' });
  const uploads = [];
  for (const side of ['FRONT', 'BACK']) uploads.push((await intake.plan(machine, auto.card.cardId,
    { requestId: randomUUID(), side, expectedVersion: 0, sha256: originalHash, byteCount: bytes.length })).upload);
  const originalPath = uploadId => join(fixture.objectDirectory, `original-${uploadId}`);
  const storage = { async readOriginal({ uploadPlan }) {
    let found; try { found = await readFile(originalPath(uploadPlan.uploadId)); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Owned original absent'), { code: 'PHOTO_OBJECT_NOT_FOUND' }); throw error; }
    return { bytes: found, sha256: digest(found), byteCount: found.length, contentType: 'application/octet-stream',
      object: { key: uploadPlan.object.key, versionId: 'owned-file-v1' } };
  } };
  const limits = { maxInputBytes: 1000000, maxPixels: 100000, maxRasterBytes: 800000, maxOutputBytes: 1000000, timeoutMs: 10000 };
  const service = createManualIntake({ repository: intake, storage, artifacts: fixture.artifacts,
    async processPhoto({ uploadPlan, verification, bytes, signal }) {
      const decoded = await verifyAndDecodePhoto({ uploadPlan, observedObject: verification.object, bytes, limits, signal });
      const working = await deriveSdrWorkingPhoto(decoded, { signal });
      return { original: decoded.original, decodePlan: decoded.decodePlan,
        decodedFrame: describeDecodedFrame(decoded, { id: `${uploadPlan.uploadId}-decoded`, object: { key: `owned/decoded/${uploadPlan.uploadId}`, versionId: null } }),
        workingFrame: describeDecodedFrame(working, { id: `${uploadPlan.uploadId}-working`, object: { key: `owned/working/${uploadPlan.uploadId}`, versionId: null } }) };
    } });
  const intakeErrors = [];
  intakeWorker = createIntakeIngestionWorker({ repository: createIntakeIngestionRepository({ boundary }), intake: service,
    authorityFor: job => boundary.machineOwner({ ownerId: job.ownerId, accessVersion: job.accessVersion }),
    intervalMs: 25, heartbeatMs: 1000, random: () => 0, onError: error => intakeErrors.push(error.code ?? error.name) });
  intakeWorker.start();
  await until(async () => (await rows('SELECT count(*)::int n FROM atlas_manual_intake.ingestion WHERE card_id=$1::uuid AND attempts>0', auto.card.cardId))[0].n === 2, 'absent original is durably retried');
  assert.equal((await intake.read(machine, auto.card.cardId)).card.ready, false);
  for (const upload of uploads) await writeFile(originalPath(upload.uploadId), bytes, { flag: 'wx', mode: 0o600 });
  await until(async () => (await intake.read(machine, auto.card.cardId)).card.ready, 'worker automatically verifies and prepares both original sides');
  assert.equal((await rows('SELECT count(*)::int n FROM atlas_manual_connected.batch_grading WHERE card_id=$1::uuid', auto.card.cardId))[0].n, 1);
  await until(async () => (await rows("SELECT count(*)::int n FROM atlas_manual_intake.ingestion WHERE card_id=$1::uuid AND state='COMPLETE'", auto.card.cardId))[0].n === 2, 'ingestion claims finalize');
  await intakeWorker.stop(); intakeWorker = null;
  for (const upload of uploads) assert.equal(digest(await readFile(originalPath(upload.uploadId))), originalHash);
  assert.deepEqual(intakeErrors, []);
  record('server polling finds later durable original bytes, verifies/decodes both sides, stores sources and admits pair with browser revoked and no completion/enqueue calls');
  const compactStatus = await intake.processingList(machine);
  const autoStatus = compactStatus.cards.find(card => card.cardId === auto.card.cardId);
  assert(autoStatus.ready && autoStatus.sides.FRONT.verified && autoStatus.sides.BACK.prepared);
  assert.equal(/sha256|object|sourceHash|claimId|ownerId|accessVersion/.test(JSON.stringify(compactStatus)), false);
  const [otherIdentity] = await rows('SELECT id,"accessVersion" AS version FROM atlas_staff."StaffIdentity" WHERE id<>$1::uuid AND role=\'REVIEWER\' LIMIT 1', owner.id);
  const otherMachine = boundary.machineOwner({ ownerId: otherIdentity.id, accessVersion: otherIdentity.version });
  assert.deepEqual(await intake.processingList(otherMachine), { cards: [] });
  record('compact persisted progress is owner-scoped and omits object keys, hashes, leases and authorization material');

  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "accessVersion"="accessVersion"+1 WHERE id=$1::uuid', owner.id);
  await assert.rejects(boundary.machineTransaction(machine, () => true), error => error.code === 'MANUAL_MACHINE_ACCESS_REVOKED');
  record('live owner access-version revocation stops previously admitted machine authority');
  await writeFile(join(output, 'postgres-result.json'), JSON.stringify({ status: 'PASS', checks, measurements,
    providerCalls: 0, productionWrites: 0, limitation: 'Real PostgreSQL, restricted roles and separate processes; expensive preparation/provider callbacks are controlled fixtures, not a provider latency benchmark.' }, null, 2), { mode: 0o600 });
} catch (error) {
  await writeFile(join(output, 'postgres-failure.json'), JSON.stringify({ code: error.code ?? error.name, message: error.message, checks, children: [...children].map(({ claims, errors, exit, stderr }) => ({ claims, errors, exit, stderr })), jobs: await rows('SELECT state,stage,count(*)::int n FROM atlas_manual_connected.batch_grading GROUP BY state,stage').catch(() => []) }, null, 2), { mode: 0o600 });
  throw error;
} finally {
  await intakeWorker?.stop();
  for (const state of children) state.child.kill('SIGKILL');
  await Promise.all([...children].map(state => until(() => state.exit !== null, 'final child cleanup').catch(() => {})));
  await machineClient?.$disconnect(); await connection.close(); await fixture.stop();
  await writeFile(join(output, 'postgres-cleanup.json'), JSON.stringify({ ownedFixtureStopped: true, childrenStopped: true }), { mode: 0o600 });
}
