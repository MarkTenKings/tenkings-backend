// Explicit owned disposable DB only. Software keys / synthetic production-
// shaped publications exercise persistence; they are not hardware qualification.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualService } from '@atlas/manual-service';
import { createPublicationRepository, publicationGrantSQL } from '../src/publication-repository.mjs';
import { createManualPublication } from '../src/publication.mjs';
import { createManualFinishing } from '../src/finishing.mjs';
import { createFinishingStationRepository, finishingStationGrantSQL } from '../src/finishing-station-repository.mjs';
import { createFinishingStationService } from '../src/finishing-station-service.mjs';
import { validateStationArm, stationEnrollmentProof, stationProfileHash, stationHash, STATION_WIRE as W } from '../src/finishing-station-protocol.mjs';
import { encodeApprovedNdef } from '@atlas/finishing/mac-nfc';
import { publicationFixture } from '../test/publication-fixture.mjs';
import { stationKeys, hashClaims } from '../test/finishing-station-fixture.mjs';

const output = process.env.ATLAS_STATION_EVIDENCE;
assert(output && resolve(output) === output, 'New absolute owned evidence directory required');
await mkdir(output, { mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2));
try {
  const checks = [];
  await fixture.cluster.sql(await readFile(new URL('../sql/finishing-station-proposal.sql', import.meta.url), 'utf8'), [], fixture.database.name);
  for (const grants of [publicationGrantSQL, finishingStationGrantSQL]) await fixture.cluster.sql(grants('atlas_fixture_manual'), [], fixture.database.name);
  const connection = fixture.connect(), { boundary, auth } = connection;
  async function login(phone) {
    const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(browser, boot.csrf, { phone, requestId: randomUUID() }, 'fixture-station');
    const verified = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-station');
    return auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  }
  const staff = await login('+12025550141'), other = await login('+12025550142');
  const actor = await boundary.transaction(staff, ({ principal }) => principal);
  const keys = stationKeys(), repository = createFinishingStationRepository({ boundary });
  const service = createFinishingStationService({ repository, finishing: { load() { throw new Error('No real hardware arming in a LOCAL fixture'); } },
    signer: keys.signer, trustedStations: [keys.trust(actor.id)] });
  const challengeInput = { requestId: randomUUID(), stationId: keys.enrollment.stationId };
  const challengeRace = await Promise.all([1, 2].map(() => service.challenge(staff, challengeInput)));
  assert.deepEqual(challengeRace[0].challenge, challengeRace[1].challenge);
  const challenge = challengeRace[0].challenge, proof = keys.proof(challenge);
  const paired = await service.enroll(staff, proof); assert.equal(paired.state, 'ACTIVE');
  await service.enroll(staff, proof);
  await assert.rejects(service.enroll({ ...staff }, proof)); await assert.rejects(service.enroll(other, proof));
  await assert.rejects(service.challenge(staff, { ...challengeInput, stationId: 'different-station' }));
  checks.push('real staff WeakMap/CSRF login, concurrent challenge replay and signed possession proof; copied/foreign actors rejected');

  const fresh = (await service.challenge(staff, { ...challengeInput, requestId: randomUUID() })).challenge;
  const again = await service.enroll(staff, keys.proof(fresh)); assert.equal(again.enrollmentId, paired.enrollmentId);
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS n FROM atlas_manual_connected.station_enrollment'))[0].n, 1);
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS n FROM atlas_manual_connected.station_pairing'))[0].n, 2);
  const foreign = stationKeys(), changed = { ...foreign.proof(fresh), enrollmentId: keys.enrollment.enrollmentId };
  changed.signature = foreign.signNative(stationEnrollmentProof(fresh, changed));
  await assert.rejects(service.enroll(staff, changed));
  const next = (await service.challenge(staff, { ...challengeInput, requestId: randomUUID() })).challenge;
  const changedFresh = { ...foreign.proof(next), enrollmentId: keys.enrollment.enrollmentId };
  changedFresh.signature = foreign.signNative(stationEnrollmentProof(next, changedFresh));
  await assert.rejects(service.enroll(staff, changedFresh), { code: 'STATION_ENROLLMENT_CHANGED' });
  checks.push('fresh challenge re-pairs the exact protected UUID without replacing first proof; each challenge is consumed once and changed key refused');

  const publicationRepository = createPublicationRepository({ boundary });
  // The fixture deliberately allocates production-shaped rows on its OWNED DB
  // to exercise the repository's production publication guard. No production
  // session, key, database, live source or hardware authority is represented.
  const manual = createManualRepository({ boundary, approvalCommitted: args => publicationRepository.approvalCommitted({ ...args, principal: { ...args.principal, mode: 'PRODUCTION' } }) });
  async function publishedCard() {
    const f = await publicationFixture(); await manual.provision(staff, { cardId: f.cardId, draft: f.draft });
    const workflow = createManualService({ repository: manual, reduce: ({ card }) => card.draft, buildReport: async () => f.approval });
    await workflow.execute(staff, f.cardId, { actionId: f.actionId, expectedRevision: 1, action: { type: 'APPROVE_REPORT', reportHash: f.row.report_hash, reviewed: true } });
    const publication = createManualPublication({ repository: publicationRepository, artifacts: f.artifacts, storage: f.storage,
      readSource: async (_staff, _id, upload) => ({ photo: f.photos[upload.side] }) });
    await publication.publish(staff, f.cardId, f.actionId);
    const finishing = createManualFinishing({ repository: publicationRepository, artifacts: f.artifacts });
    return { ...f, plan: await finishing.load(staff, f.cardId, f.actionId) };
  }
  const cards = [await publishedCard(), await publishedCard(), await publishedCard(), await publishedCard()];
  const before = await Promise.all(cards.map(f => manual.load(staff, f.cardId)));
  const approvalsBefore = await Promise.all(cards.map(f => manual.readApproval(staff, f.cardId, f.actionId)));
  const trust = keys.trust(actor.id);
  async function candidate(card, ttl = 900000) {
    const enrolled = await repository.enrollment(staff, keys.enrollment.enrollmentId), plan = card.plan;
    const input = { requestId: randomUUID(), stationId: keys.enrollment.stationId, enrollmentId: keys.enrollment.enrollmentId,
      cardId: card.cardId, approvalActionId: card.actionId, physicalCardPresent: true };
    const claims = validateStationArm({ version: W.arm, origin: 'https://atlasgrading.com', stationId: keys.enrollment.stationId,
      enrollmentId: keys.enrollment.enrollmentId, keyId: keys.enrollment.keyId, intentId: plan.nfc.intentId,
      planHash: plan.planHash, profileHash: stationProfileHash(trust.profile), qualificationHash: trust.profile.qualificationHash,
      activationId: trust.activationId, cardId: card.cardId, approvalActionId: card.actionId, publicHash: plan.binding.publicHash,
      reportHash: plan.binding.reportHash, approvalVersion: plan.binding.approvalVersion, reportNumber: plan.binding.reportNumber,
      url: plan.nfc.url, ndefHash: stationHash(encodeApprovedNdef(plan)), firstUserPage: trust.profile.firstUserPage,
      lastUserPage: trust.profile.lastUserPage, nonce: randomBytes(32).toString('base64url'), issuedAt: enrolled.now, expiresAt: enrolled.now + ttl });
    return { input, claims, authorization: await keys.signer.signClaims(claims) };
  }
  const first = await candidate(cards[0]), second = await candidate(cards[1]);
  await assert.rejects(service.arm(staff, first.input), { code: 'STATION_PRODUCTION_SESSION_REQUIRED' });
  const race = await Promise.allSettled([first, second].map(c => repository.reserveArm(staff, c.input, c.claims, c.authorization)));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1); assert.equal(race.filter(r => r.status === 'rejected').length, 1);
  const index = race.findIndex(r => r.status === 'fulfilled'), winner = [first, second][index], loser = [first, second][1 - index];
  assert.deepEqual(await repository.reserveArm(staff, winner.input, winner.claims, winner.authorization), race[index].value);
  await assert.rejects(repository.reserveArm(staff, { ...winner.input, physicalCardPresent: false }, winner.claims, winner.authorization));
  await assert.rejects(repository.intent(other, winner.claims.intentId));
  await assert.rejects(repository.reserveArm(other, loser.input, loser.claims, loser.authorization));
  assert.equal((await service.list(staff)).stations[0].activeIntentId, winner.claims.intentId);
  checks.push('two different cards compete for one physical station: one winner; exact retry preserves authority and unrelated actor cannot access it; LOCAL service cannot arm');

  const write = keys.result(winner.claims), signedWrite = { receipt: write, signature: keys.signNative(write) };
  const acks = await Promise.all([1, 2].map(() => service.acknowledge(staff, signedWrite)));
  const committed = await keys.verifier.verifyEnvelope(acks[0]); assert.deepEqual(await keys.verifier.verifyEnvelope(acks[1]), committed);
  assert.equal(committed.receiptHash, hashClaims(write)); assert.equal((await service.list(staff)).stations[0].activeIntentId, winner.claims.intentId);
  const freshRepository = createFinishingStationRepository({ boundary });
  const recovered = await freshRepository.intent(staff, winner.claims.intentId); assert.equal(recovered.receipts.length, 1);
  const removal = keys.removal(winner.claims, write), signedRemoval = { receipt: removal, signature: keys.signNative(removal) };
  const removed = await service.complete(staff, signedRemoval); assert.equal((await keys.verifier.verifyEnvelope(removed)).kind, 'REMOVAL');
  assert.deepEqual(await keys.verifier.verifyEnvelope(await service.complete(staff, signedRemoval)), await keys.verifier.verifyEnvelope(removed));
  assert.equal((await service.list(staff)).stations[0].activeIntentId, null);
  await assert.rejects(repository.reserveArm(staff, { ...winner.input, requestId: randomUUID() }, winner.claims, winner.authorization), { code: 'STATION_PLAN_ALREADY_ARMED' });
  const loserSaved = await repository.reserveArm(staff, loser.input, loser.claims, loser.authorization); assert.equal(loserSaved.claims.intentId, loser.claims.intentId);
  const loserWrite = keys.result(loser.claims); await service.acknowledge(staff, { receipt: loserWrite, signature: keys.signNative(loserWrite) });
  const loserRemoval = keys.removal(loser.claims, loserWrite); await service.complete(staff, { receipt: loserRemoval, signature: keys.signNative(loserRemoval) });
  checks.push('concurrent signed WRITE commits one immutable receipt before ack; fresh repository recovers it; signed removal atomically releases station; same publication cannot write twice');

  const custody = await candidate(cards[3], 1000); await repository.reserveArm(staff, custody.input, custody.claims, custody.authorization);
  const custodyWrite = keys.result(custody.claims), signedCustody = { receipt: custodyWrite, signature: keys.signNative(custodyWrite) };
  const lostAck = createFinishingStationService({ repository, finishing: { load() {} }, trustedStations: [keys.trust(actor.id)],
    signer: { ...keys.signer, signClaims() { throw new Error('synthetic lost host signing response'); } } });
  await assert.rejects(lostAck.acknowledge(staff, signedCustody), /lost host signing response/);
  assert.equal((await repository.intent(staff, custody.claims.intentId)).receipts.length, 1);
  const custodyRemoval = keys.removal(custody.claims, custodyWrite), removalSignature = keys.signNative(custodyRemoval);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const recoveredAck = await service.acknowledge(staff, signedCustody);
  assert.equal((await keys.verifier.verifyEnvelope(recoveredAck)).receiptHash, hashClaims(custodyWrite));
  await service.complete(staff, { receipt: custodyRemoval, signature: removalSignature });
  assert.equal((await repository.intent(staff, custody.claims.intentId)).receipts.length, 2);
  checks.push('real DB write remains committed when host signing fails; exact custody replay and already-signed removal recover after expiry without new RF or signature');

  const expiring = await candidate(cards[2], 500); await repository.reserveArm(staff, expiring.input, expiring.claims, expiring.authorization);
  await new Promise(resolve => setTimeout(resolve, 650));
  const expiredWrite = keys.result(expiring.claims);
  await assert.rejects(service.acknowledge(staff, { receipt: expiredWrite, signature: keys.signNative(expiredWrite) }), { code: 'STATION_ARM_EXPIRED' });
  assert.equal((await service.list(staff)).stations[0].activeIntentId, expiring.claims.intentId);
  assert.equal((await repository.intent(staff, expiring.claims.intentId)).receipts.length, 0);
  checks.push('expired unknown write remains occupied with no receipt or fabricated completion; no automatic reset or second tag authorization');

  for (const table of ['station_challenge','station_enrollment','station_pairing','station_arm','station_receipt']) {
    await assert.rejects(fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual_connected.${table} SET ${table === 'station_receipt' ? 'signature=signature' : table === 'station_arm' ? 'station_id=station_id' : table === 'station_challenge' ? 'station_id=station_id' : 'actor_id=actor_id'}`));
    await assert.rejects(fixture.admin.$executeRawUnsafe(`DELETE FROM atlas_manual_connected.${table}`));
    const [privilege] = await fixture.admin.$queryRawUnsafe(`SELECT has_table_privilege('atlas_fixture_public',$1,'SELECT') AS public_read,
      has_table_privilege('atlas_fixture_manual',$1,'UPDATE') AS manual_update,has_table_privilege('atlas_fixture_manual',$1,'DELETE') AS manual_delete`, `atlas_manual_connected.${table}`);
    assert.deepEqual(privilege, { public_read: false, manual_update: false, manual_delete: false });
  }
  assert.deepEqual(await Promise.all(cards.map(f => manual.load(staff, f.cardId))), before);
  assert.deepEqual(await Promise.all(cards.map(f => manual.readApproval(staff, f.cardId, f.actionId))), approvalsBefore);
  checks.push('DB rejects history UPDATE/DELETE even as owned fixture admin; public role cannot read and serving role cannot rewrite history; source cards/approvals remain byte-exact');
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "accessVersion"="accessVersion"+1 WHERE id=$1::uuid', actor.id);
  await assert.rejects(service.list(staff)); await assert.rejects(service.acknowledge(staff, signedWrite));
  checks.push('revoking the current staff access version immediately blocks station reads and even exact custody replay');
  const result = { status: 'PASS', checks, scope: 'owned disposable PostgreSQL; real LOCAL staff authentication, synthetic production-shaped publication, ephemeral software P256 keys; no hardware qualification',
    paidEffects: 0, hardwareEffects: 0, remoteEffects: 0 };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); console.log(JSON.stringify(result));
} finally { await fixture.stop(); await copyFile(join(fixture.cluster.directory, 'cleanup.json'), join(output, 'cleanup.json')); }
