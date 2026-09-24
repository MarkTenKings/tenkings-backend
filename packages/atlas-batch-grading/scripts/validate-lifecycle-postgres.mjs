// Actual worker/repository/auth on an owned disposable PostgreSQL cluster.
// The ten cards, photo metadata and preparation responses are synthetic. This
// checks interruption recovery, not optical grading or real-card acceptance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest, requireThat } from '../../atlas-manual-service/src/contract.mjs';
import { intakeGrantSQL } from '../../atlas-manual-intake/src/repository.mjs';
import { createBatchRepository, batchGrantSQL } from '../src/repository.mjs';
import { createBatchWorker } from '../src/index.mjs';

const fixture = await createOwnedManualFixture(process.argv.slice(2));
const workers = [], checks = [], unblock = [];
let completed = false;
async function until(check) {
  for (let i = 0; i < 600; i++) { if (await check()) return; await delay(20); }
  assert.fail('Batch lifecycle did not settle');
}
try {
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql('GRANT USAGE ON SCHEMA atlas_manual_connected TO atlas_fixture_manual', [], fixture.database.name);
  await fixture.cluster.sql(batchGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const connection = fixture.connect(), { auth, boundary } = connection;
  async function login(phone = '+12025550141') {
    const bootstrap = await auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${bootstrap.browserToken}`;
    const challenge = await auth.send(cookie, bootstrap.csrf, { phone, requestId: randomUUID() }, 'batch-lifecycle-disposable');
    const verified = await auth.verify(cookie, bootstrap.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'batch-lifecycle-disposable');
    return auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  }
  let staff = await login();
  const source = row => digest(canonical([row.id, row.pair_id, row.front_upload_id, row.back_upload_id]));
  const intakeRepository = { async authorizeInTransaction(tx, principal, id, { lock = '' } = {}) {
    const [row] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_intake.card WHERE id=$1::uuid${lock ? ` FOR ${lock}` : ''}`, id);
    requireThat(row && row.owner_id === principal.id && principal.role === 'REVIEWER', 403, 'INTAKE_CARD_ACCESS_DENIED');
    return { cardId: id, ready: true, sourceHash: source(row), label: row.label,
      sides: { FRONT: { upload: { uploadId: row.front_upload_id } }, BACK: { upload: { uploadId: row.back_upload_id } } } };
  } };
  const repository = createBatchRepository({ boundary, intakeRepository });
  async function upload(cardId, side, version = 1) {
    const id = randomUUID(), body = canonical({ fixture: 'synthetic queue metadata only' });
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.upload(id,card_id,request_id,actor_id,request,request_hash,side,version,plan,plan_hash)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$5,$6)`, id, cardId, randomUUID(), staff.id, body, digest(body), side, version);
    return id;
  }
  const cards = [];
  for (let i = 0; i < 10; i++) {
    const id = randomUUID(), pairId = randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)`, id, pairId, staff.id, randomUUID(), digest(id), `Synthetic lifecycle ${i}`);
    const front = await upload(id, 'FRONT'), back = await upload(id, 'BACK');
    await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_intake.card SET front_upload_id=$2::uuid,back_upload_id=$3::uuid,front_version=1,back_version=1,revision=2 WHERE id=$1::uuid', id, front, back);
    cards.push({ cardId: id, sourceHash: source({ id, pair_id: pairId, front_upload_id: front, back_upload_id: back }) });
  }
  const initial = await repository.enqueue(staff, { actionId: randomUUID(), cards });
  const identityByKey = new Map(initial.jobs.map(job => [job.key, job.analysisActionId]));
  const liveClaim = await repository.claim(staff, randomUUID(), 2);
  const previousStaff = staff;
  await fixture.admin.staffIdentity.update({ where: { id: staff.id }, data: { accessVersion: { increment: 1 } } });
  staff = await login();
  await assert.rejects(repository.list(previousStaff), error => error.status === 401 || error.status === 403);
  const liveAccess = (await repository.list(staff)).jobs.find(job => job.key === liveClaim.key);
  assert.equal(liveAccess.state, 'RUNNING', 'Access renewal cannot steal an unexpired execution lease');
  await assert.rejects(repository.resume(staff, { key: liveAccess.key, expectedRevision: liveAccess.revision }), error => error.code === 'BATCH_RESUME_STALE');
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", liveClaim.key);
  const interruptedAccess = (await repository.list(staff)).jobs;
  assert.equal(interruptedAccess.length, 10);
  assert.ok(interruptedAccess.every(job => job.state === 'NEEDS_ATTENTION' && job.code === 'BATCH_ACCESS_CHANGED'),
    'Changed staff access must expose recoverable pending jobs instead of silently stranding them');
  const other = await login('+12025550143');
  await assert.rejects(repository.resume(other, { key: interruptedAccess[0].key, expectedRevision: interruptedAccess[0].revision }), error => error.code === 'BATCH_NOT_FOUND');
  for (const job of interruptedAccess) {
    const resumed = await repository.resume(staff, { key: job.key, expectedRevision: job.revision });
    assert.equal(resumed.job.state, 'QUEUED'); assert.equal(resumed.job.analysisActionId, identityByKey.get(job.key));
    await assert.rejects(repository.resume(staff, { key: job.key, expectedRevision: job.revision }), error => error.code === 'BATCH_RESUME_STALE');
  }
  checks.push('current ordinary session can explicitly resume all ten access-fenced jobs; live leases, stale/other sessions and repeated revisions remain fenced');

  let entered = 0, release;
  const gate = new Promise(resolve => { release = resolve; }), errors = [];
  unblock.push(release);
  const firstWorker = createBatchWorker({ repository, concurrency: 2, onError: error => errors.push(error.code), prepare: { async run() {
    entered++; await gate; return { kind: 'CONTINUE' };
  } } });
  workers.push(firstWorker); firstWorker.wake(staff); await until(() => entered === 2);
  let stopped = false;
  const stopping = firstWorker.stop().then(() => { stopped = true; });
  await delay(20); assert.equal(stopped, false); release(); await stopping;
  const afterStop = (await repository.list(staff)).jobs;
  assert.equal(afterStop.filter(job => job.stage === 'ANALYZE').length, 2);
  assert.equal(afterStop.filter(job => job.stage === 'PREPARE').length, 8);
  assert.ok(afterStop.every(job => job.state === 'QUEUED'));
  checks.push('graceful stop waits for both in-flight commits and starts none of the remaining eight cards');

  // Model a process that died after its durable claim: only the owned fixture
  // clock is advanced. The stale lease cannot complete after replacement.
  const abandoned = await repository.claim(staff, randomUUID(), 2);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", abandoned.key);
  const freshRepository = createBatchRepository({ boundary, intakeRepository });
  const replacement = await freshRepository.claim(staff, randomUUID(), 2);
  assert.equal(replacement.key, abandoned.key); assert.notEqual(replacement.claimId, abandoned.claimId);
  assert.equal(await repository.finish(staff, abandoned, { kind: 'CONTINUE' }), false);
  await freshRepository.finish(staff, replacement, { kind: 'WAIT', retryAfterMs: 2000 });
  checks.push('fresh repository recovers an expired claim and rejects the original process commit');

  const uncertain = initial.jobs[0], busy = initial.jobs[1], changed = initial.jobs[2];
  let uncertainRun = null, dispatches = 0, uncertainCalls = 0, busyCalls = 0, peak = 0, active = 0;
  const report = job => ({ kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash,
    reportHash: digest(`synthetic report:${job.key}`), manualRevision: 1,
    manualContentHash: digest(canonical({ source: { sourceHash: job.sourceHash } })) } });
  const prepare = { async run(_staff, job) {
    active++; peak = Math.max(peak, active);
    try {
      await delay(1);
      if (job.key === changed.key) {
        const front = await upload(job.cardId, 'FRONT', 2);
        await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_intake.card SET front_upload_id=$2::uuid,front_version=2,revision=revision+1 WHERE id=$1::uuid', job.cardId, front);
        return { kind: 'CONTINUE' };
      }
      if (job.stage === 'ANALYZE' && job.key === busy.key && ++busyCalls === 1)
        throw Object.assign(new Error('Synthetic capacity refusal before dispatch'), { code: 'MANUAL_PROCESSING_BUSY', status: 503 });
      if (job.stage === 'ANALYZE' && job.key === uncertain.key) {
        uncertainCalls++; assert.equal(job.analysisActionId, identityByKey.get(job.key));
        if (!uncertainRun) {
          uncertainRun = randomUUID(); dispatches++;
          const payload = canonical({ fixture: 'synthetic provider journal; no actual provider request' });
          const manual = canonical({ source: { sourceHash: job.sourceHash } });
          await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)', job.cardId, manual, digest(manual), staff.id);
          await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$5,$5,$6,$6,$5,'PREPARED',clock_timestamp()+interval '4 minutes')`, uncertainRun, job.cardId, job.analysisActionId, staff.id, digest(payload), payload);
          await fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid", uncertainRun);
          throw Object.assign(new Error('Synthetic lost provider response'), { code: 'BATCH_ANALYSIS_UNCERTAIN' });
        }
      }
      return job.stage === 'REPORT' ? report(job) : { kind: 'CONTINUE' };
    } finally { active--; }
  } };
  const worker = createBatchWorker({ repository: freshRepository, prepare, concurrency: 2, onError: error => errors.push(error.code) });
  workers.push(worker); worker.wake(staff);
  await until(async () => {
    const jobs = (await freshRepository.list(staff)).jobs;
    return jobs.filter(job => job.state === 'REVIEW').length === 8 && jobs.some(job => job.key === uncertain.key && job.state === 'NEEDS_ATTENTION')
      && jobs.some(job => job.key === changed.key && job.state === 'SUPERSEDED');
  });
  assert.ok(peak <= 2); assert.equal(busyCalls, 2); assert.equal(dispatches, 1);
  const [sourceRow] = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.batch_grading WHERE key=$1', changed.key);
  assert.equal(sourceRow.stage, 'PREPARE', 'A replaced pair cannot advance from its stale result');
  assert.equal(sourceRow.claim_id !== null, true);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", changed.key);
  await worker.tick(staff);
  const replaced = (await freshRepository.list(staff)).jobs.find(job => job.key === changed.key);
  await assert.rejects(freshRepository.resume(staff, { key: replaced.key, expectedRevision: replaced.revision }), error => error.code === 'BATCH_PHOTOS_CHANGED');
  const [uncertainRow] = await fixture.admin.$queryRawUnsafe('SELECT analysis_reserved FROM atlas_manual_connected.batch_grading WHERE key=$1', uncertain.key);
  assert.equal(uncertainRow.analysis_reserved, true, 'Uncertain provider liability retains its capacity slot');
  checks.push('one uncertain analysis and one source replacement do not block the other eight cards; native contention retries the same job');

  const payload = canonical({ fixture: 'synthetic provider journal; no actual provider request' });
  await fixture.admin.$executeRawUnsafe("INSERT INTO atlas_defect_analysis.receipt(analysis_id,kind,request_hash,evidence) VALUES($1::uuid,'RESPONSE',$2,$3)", uncertainRun, digest(payload), canonical({ fixture: 'synthetic terminal result' }));
  const toResume = (await freshRepository.list(staff)).jobs.find(job => job.key === uncertain.key);
  await freshRepository.resume(staff, { key: toResume.key, expectedRevision: toResume.revision });
  await worker.tick(staff);
  await until(async () => (await freshRepository.list(staff)).jobs.filter(job => job.state === 'REVIEW').length === 9);
  await worker.stop(); assert.equal(dispatches, 1); assert.equal(uncertainCalls, 2);
  checks.push('terminal receipt followed by explicit resume reuses original analysis action without redispatch');

  const reviewBefore = (await freshRepository.readReview(staff, busy.key)).job;
  const manual = canonical({ source: { sourceHash: busy.sourceHash } });
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)', busy.cardId, manual, digest(manual), staff.id);
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_connected.batch_grading SET evidence=$2 WHERE key=$1', busy.key,
    canonical({ ...reviewBefore.evidence, manualContentHash: digest(manual) }));
  const reviewInput = { reportHash: reviewBefore.evidence.reportHash, reviewed: true };
  await freshRepository.beginReview(staff, busy.key, reviewInput);
  const savedReview = await freshRepository.readReview(staff, busy.key);
  await fixture.admin.staffIdentity.update({ where: { id: staff.id }, data: { accessVersion: { increment: 1 } } });
  staff = await login();
  const accessReview = (await freshRepository.list(staff)).jobs.find(job => job.key === busy.key);
  assert.equal(accessReview.state, 'NEEDS_ATTENTION'); assert.equal(accessReview.code, 'BATCH_ACCESS_CHANGED');
  const recoveredReview = await freshRepository.resume(staff, { key: busy.key, expectedRevision: accessReview.revision });
  assert.equal(recoveredReview.job.state, 'REVIEW');
  const afterReview = await freshRepository.readReview(staff, busy.key);
  assert.deepEqual(afterReview.review, savedReview.review); assert.deepEqual(afterReview.job.evidence, savedReview.job.evidence);
  assert.equal(afterReview.job.analysisActionId, savedReview.job.analysisActionId);
  const [authorityCounts] = await fixture.admin.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM atlas_manual.approval) AS approvals,(SELECT count(*)::int FROM atlas_manual.action) AS actions');
  assert.deepEqual(authorityCounts, { approvals: 0, actions: 0 });
  assert.deepEqual(errors, ['BATCH_PHOTOS_CHANGED']);
  checks.push('review access renewal preserves exact report and existing immutable review intent with zero grading approvals/actions');
  console.log(JSON.stringify({ status: 'BATCH_TEN_CARD_LIFECYCLE_POSTGRES_PASS', checks, directory: fixture.cluster.directory,
    realPhotographs: false, providerRequests: 0, cards: 10, syntheticDispatches: dispatches, peakPreparationConcurrency: peak }));
  completed = true;
} finally {
  for (const release of unblock) release();
  await Promise.all(workers.map(worker => worker.stop()));
  if (!completed) console.log(JSON.stringify({ status: 'BATCH_LIFECYCLE_FAILURE_STATE', checks, directory: fixture.cluster.directory,
    jobs: await fixture.admin.$queryRawUnsafe('SELECT stage,state,code,attempts,analysis_reserved,claim_id IS NOT NULL AS claimed FROM atlas_manual_connected.batch_grading ORDER BY created_at,key') }));
  await fixture.stop();
}
