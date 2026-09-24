import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createOwnedManualFixture } from './owned-fixture.mjs';
import { createManualService } from '../src/service.mjs';
import { digest } from '../src/contract.mjs';

const fixture = await createOwnedManualFixture(process.argv.slice(2));
const checks = [];
const record = (name, evidence = true) => checks.push({ name, evidence });
let connection = fixture.connect();
async function login(phone) {
  const { auth } = connection;
  const boot = await auth.bootstrap('');
  const cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await auth.send(cookie, boot.csrf, { phone, requestId: randomUUID() }, 'fixture-manual');
  const verified = await auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-manual');
  const signedCookie = `${cookie}; ${fixture.config.cookies.session}=${verified.token}`;
  return { cookie: signedCookie, csrf: verified.csrf, staff: await auth.authenticate(signedCookie, verified.csrf) };
}
const denied = (promise, code) => assert.rejects(promise, error => error.code === code);
try {
  const reviewer = await login('+12025550141'), observer = await login('+12025550142'), second = await login('+12025550143');
  record('ordinary DurableStaffAuth browser/challenge/session verification; synthetic SMS provider explicitly');
  const cardId = randomUUID(), secondId = randomUUID();
  const first = await connection.repository.provision(reviewer.staff, { cardId, draft: { geometryRevision: 1, defectsRevision: 1, notes: '' } });
  await connection.repository.provision(second.staff, { cardId: secondId, draft: { geometryRevision: 1, defectsRevision: 1, notes: '' } });
  await denied(connection.repository.load({ ...reviewer.staff }, cardId), 'SIGN_IN_REQUIRED');
  await denied(connection.repository.load(second.staff, cardId), 'MANUAL_CARD_NOT_FOUND');
  await denied(connection.repository.provision(observer.staff, { cardId: randomUUID(), draft: {} }), 'MANUAL_CARD_ACCESS_DENIED');
  record('opaque auth handles, unrelated card and observer write denial');
  let reducerCalls = 0, release;
  const paused = new Promise(done => { release = done; });
  const reduce = async ({ card, action }) => {
    reducerCalls++;
    if (action.type === 'PAUSE') await paused;
    return { ...card.draft, notes: action.notes, defectsRevision: card.draft.defectsRevision + 1 };
  };
  let service = createManualService({ repository: connection.repository, reduce,
    buildReport: async ({ card }) => ({ schemaVersion: 1, reportSource: card.contentHash, declared: 'synthetic report snapshot' }) });
  const command = { actionId: randomUUID(), expectedRevision: 1, action: { type: 'SAVE_NOTES', notes: 'first saved revision' } };
  const committed = await service.execute(reviewer.staff, cardId, command);
  assert.equal(committed.card.revision, 2); assert.equal(reducerCalls, 1);
  assert.deepEqual(await service.execute(reviewer.staff, cardId, command), committed); assert.equal(reducerCalls, 1);
  assert.deepEqual((await service.status(reviewer.staff, cardId, command.actionId)).result, committed);
  await denied(service.execute(reviewer.staff, cardId, { ...command, action: { type: 'SAVE_NOTES', notes: 'changed replay' } }), 'MANUAL_ACTION_ID_CONFLICT');
  await denied(service.execute(reviewer.staff, cardId, { ...command, actionId: randomUUID() }), 'MANUAL_DRAFT_STALE');
  await denied(service.execute(reviewer.staff, cardId, { ...command, actionId: randomUUID(), action: { type: 'SAVE_NOTES', actor: 'HUMAN' } }), 'MANUAL_CLIENT_AUTHORITY_FORBIDDEN');
  record('CAS, identical replay, altered-action rejection and lost-response readback');
  const current = await service.read(reviewer.staff, cardId);
  const pair = await Promise.allSettled(['winner-a', 'winner-b'].map(notes => service.execute(reviewer.staff, cardId,
    { actionId: randomUUID(), expectedRevision: current.revision, action: { type: 'SAVE_NOTES', notes } })));
  assert.equal(pair.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(pair.find(result => result.status === 'rejected').reason.code, 'MANUAL_DRAFT_STALE');
  record('simultaneous same-card actions commit exactly one revision');
  const busyRevision = (await service.read(reviewer.staff, cardId)).revision;
  const busy = service.execute(reviewer.staff, cardId, { actionId: randomUUID(), expectedRevision: busyRevision, action: { type: 'PAUSE', notes: 'after measurement' } });
  const beforeCalls = reducerCalls;
  while (reducerCalls === beforeCalls) await new Promise(done => setTimeout(done, 5));
  const began = Date.now();
  const independent = await service.execute(second.staff, secondId, { actionId: randomUUID(), expectedRevision: 1, action: { type: 'SAVE_NOTES', notes: 'independent' } });
  assert.equal(independent.card.revision, 2);
  release(); await busy;
  record('paused reducer holds no database transaction and another grader/card commits', { otherCardMs: Date.now() - began });
  const source = { cardId, kind: 'DEFECTS', sourceHash: digest('owned synthetic exact-source') };
  const full = { schemaVersion: 1, bitmap: '1'.repeat(376344), trace: { changed: true }, findingRevision: 5 };
  const ref = await fixture.artifacts.write(full, source);
  assert.deepEqual(await fixture.artifacts.read(ref, source), full);
  const saving = await service.read(reviewer.staff, cardId);
  const artCommand = { actionId: randomUUID(), expectedRevision: saving.revision, action: { type: 'SAVE_ARTIFACT', notes: 'immutable defect reference' } };
  const stored = await connection.repository.commit(reviewer.staff, { cardId, input: artCommand, baseHash: saving.contentHash,
    draft: { ...saving.draft, defectsRef: ref, defectsSourceHash: source.sourceHash } });
  assert.equal(JSON.stringify(stored.card.draft).length < 2000, true);
  record('376344-character bitmap in immutable file artifact; compact PostgreSQL reference only');
  const freshProcess = await fixture.readInFreshProcess({ cookie: reviewer.cookie, csrf: reviewer.csrf, cardId, action: command, artifactSource: source });
  assert.notEqual(freshProcess.pid, process.pid); assert.deepEqual(freshProcess.card, stored.card);
  assert.deepEqual(freshProcess.replay, committed); assert.equal(freshProcess.artifactContentHash, digest(JSON.stringify(full)));
  record('separate OS process authenticates the existing cookie, hydrates disk artifact and replays the exact prior receipt', { childPid: freshProcess.pid });
  const bootCookie = reviewer.cookie;
  await connection.close(); connection = fixture.connect();
  reviewer.staff = await connection.auth.authenticate(bootCookie, reviewer.csrf);
  service = createManualService({ repository: connection.repository, reduce,
    buildReport: async ({ card }) => ({ schemaVersion: 1, reportSource: card.contentHash, declared: 'synthetic report snapshot' }) });
  const reloaded = await service.read(reviewer.staff, cardId);
  assert.deepEqual(reloaded, stored.card); assert.deepEqual(await fixture.artifacts.read(reloaded.draft.defectsRef, source), full);
  assert.deepEqual(await service.execute(reviewer.staff, cardId, command), committed);
  record('all auth/repository/service clients recreated; cookie session, exact draft, artifact and receipt survive');
  const preview = await service.previewReport(reviewer.staff, cardId);
  const approvalCommand = { actionId: randomUUID(), expectedRevision: reloaded.revision,
    action: { type: 'APPROVE_REPORT', reviewed: true, reportHash: preview.reportHash } };
  const approved = await service.execute(reviewer.staff, cardId, approvalCommand);
  assert.equal(approved.receipt.approval.reportHash, preview.reportHash);
  assert.deepEqual(await service.execute(reviewer.staff, cardId, approvalCommand), approved);
  const approvalRows = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid', cardId);
  assert.equal(approvalRows.length, 1); assert.equal(approvalRows[0].report, JSON.stringify(preview.report, Object.keys(preview.report).sort()));
  await assert.rejects(fixture.admin.$executeRawUnsafe('UPDATE atlas_manual.approval SET source_revision=source_revision+1 WHERE card_id=$1::uuid', cardId), /immutable/);
  await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_manual.action WHERE card_id=$1::uuid', cardId), /immutable/);
  record('exact separate trained-human approval snapshot, same-action replay and database immutability');
  const savedApproval = await service.readApproval(reviewer.staff, cardId, approvalCommand.actionId);
  await service.execute(reviewer.staff, cardId, { actionId: randomUUID(), expectedRevision: approved.card.revision,
    action: { type: 'SAVE_NOTES', notes: 'edit after approval' } });
  assert.deepEqual(await service.readApproval(reviewer.staff, cardId, approvalCommand.actionId), savedApproval);
  record('subsequent draft edits preserve the exact older approved report snapshot');
  const unsafe = createManualService({ repository: (await import('../src/repository.mjs')).createManualRepository({
    boundary: (await import('../src/staff-auth.mjs')).createDurableStaffBoundary({ auth: connection.auth, manualClient: fixture.admin }) }), reduce });
  await denied(unsafe.read(reviewer.staff, cardId), 'MANUAL_DATABASE_ROLE_INVALID');
  record('owner/superuser database client is rejected by the manual runtime');
  // A real lock delay straddles certification expiry. Shared identity locks
  // prevent explicit changes, but must not preserve elapsed certification.
  const certIdentity = await fixture.admin.staffIdentity.findUnique({ where: { id: reviewer.staff.id } });
  await fixture.admin.staffIdentity.update({ where: { id: reviewer.staff.id }, data: {
    certificationUntil: new Date(Date.now() + 700), accessVersion: certIdentity.accessVersion + 1 } });
  Object.assign(reviewer, await login('+12025550141'));
  const certPreview = await service.previewReport(reviewer.staff, cardId);
  let rowHeld;
  const rowReady = new Promise(done => { rowHeld = done; });
  const held = fixture.admin.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', cardId);
    rowHeld(); await new Promise(done => setTimeout(done, 850));
  });
  await rowReady;
  await denied(service.execute(reviewer.staff, cardId, { actionId: randomUUID(), expectedRevision: certPreview.sourceRevision,
    action: { type: 'APPROVE_REPORT', reviewed: true, reportHash: certPreview.reportHash } }), 'MANUAL_CERTIFICATION_REQUIRED');
  await held;
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT revision FROM atlas_manual.card WHERE id=$1::uuid', cardId))[0].revision, certPreview.sourceRevision);
  const currentIdentity = await fixture.admin.staffIdentity.findUnique({ where: { id: reviewer.staff.id } });
  await fixture.admin.staffIdentity.update({ where: { id: reviewer.staff.id }, data: {
    certificationUntil: new Date(Date.now() + 3600000), accessVersion: currentIdentity.accessVersion + 1 } });
  Object.assign(reviewer, await login('+12025550141'));
  record('actual card-row wait crosses certification expiry; final approval denied with no revision added');
  await connection.boundary.transaction(reviewer.staff, async ({ tx, refresh }) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Honolulu'");
    assert.equal((await refresh()).principal.id, reviewer.staff.id);
  });
  record('UTC auth timestamps remain valid when PostgreSQL session timezone differs');
  assert.deepEqual(await service.latestApproval(reviewer.staff, cardId), savedApproval);
  assert.equal(await service.latestApproval((await login('+12025550143')).staff, secondId), null);
  record('latest approved snapshot readback and no-approval result');
  const currentForRevocation = await service.read(reviewer.staff, cardId);
  let reducerStarted, resumeReducer;
  const beganReducer = new Promise(done => { reducerStarted = done; });
  const resume = new Promise(done => { resumeReducer = done; });
  const revocationService = createManualService({ repository: connection.repository,
    reduce: async ({ card }) => { reducerStarted(); await resume; return { ...card.draft, notes: 'must not commit after logout' }; } });
  const pending = revocationService.execute(reviewer.staff, cardId, { actionId: randomUUID(), expectedRevision: currentForRevocation.revision,
    action: { type: 'SAVE_NOTES', notes: 'revoke during measurement' } });
  await beganReducer;
  await connection.auth.logout(reviewer.cookie, reviewer.csrf);
  resumeReducer(); await denied(pending, 'SIGN_IN_REQUIRED');
  await denied(service.read(reviewer.staff, cardId), 'SIGN_IN_REQUIRED');
  const unchanged = (await fixture.admin.$queryRawUnsafe('SELECT revision FROM atlas_manual.card WHERE id=$1::uuid', cardId))[0];
  assert.equal(unchanged.revision, currentForRevocation.revision);
  record('logout while external reducer runs fences its later commit; prior handle and zero added revision verified');
  await writeFile(join(fixture.cluster.directory, 'manual-result.json'), JSON.stringify({ ok: true, checks, node: process.version,
    databaseVersion: (await fixture.admin.$queryRawUnsafe('SELECT version() AS version'))[0].version }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, directory: fixture.cluster.directory }, null, 2));
} finally {
  await fixture.stop();
  console.log(JSON.stringify({ stopped: true, directory: fixture.cluster.directory }));
}
