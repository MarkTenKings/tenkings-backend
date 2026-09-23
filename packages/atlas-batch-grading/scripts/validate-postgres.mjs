// Owned disposable PostgreSQL only; no ambient or production URL is accepted.
// Synthetic photo metadata isolates actual queue SQL/auth/lease behavior. The
// connected intake and CPU suites separately qualify photographs and scoring.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest, requireThat } from '../../atlas-manual-service/src/contract.mjs';
import { intakeGrantSQL } from '../../atlas-manual-intake/src/repository.mjs';
import { createBatchRepository, batchGrantSQL } from '../src/repository.mjs';

const fixture = await createOwnedManualFixture(process.argv.slice(2));
const checks = [];
try {
  const [installed] = await fixture.admin.$queryRawUnsafe("SELECT to_regclass('atlas_manual_connected.batch_grading')::text AS relation");
  if (!installed.relation) await fixture.cluster.sql(await readFile(new URL('../sql/proposal.sql', import.meta.url), 'utf8'), [], fixture.database.name);
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql('GRANT USAGE ON SCHEMA atlas_manual_connected TO atlas_fixture_manual', [], fixture.database.name);
  await fixture.cluster.sql(batchGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const connection = fixture.connect(), { auth, boundary } = connection;
  async function login(phone) {
    const bootstrap = await auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${bootstrap.browserToken}`;
    const challenge = await auth.send(cookie, bootstrap.csrf, { phone, requestId: randomUUID() }, 'batch-disposable');
    const verified = await auth.verify(cookie, bootstrap.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'batch-disposable');
    return auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  }
  const staff = await login('+12025550141'), other = await login('+12025550143');
  const source = row => digest(canonical([row.id, row.pair_id, row.front_upload_id, row.back_upload_id]));
  const intakeRepository = { async authorizeInTransaction(tx, principal, id, { lock = '' } = {}) {
    const [row] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_intake.card WHERE id=$1::uuid${lock ? ` FOR ${lock}` : ''}`, id);
    requireThat(row && row.owner_id === principal.id && principal.role === 'REVIEWER', 403, 'INTAKE_CARD_ACCESS_DENIED');
    return { cardId: row.id, label: row.label, ready: true, sourceHash: source(row), sides: {
      FRONT: { upload: { uploadId: row.front_upload_id } }, BACK: { upload: { uploadId: row.back_upload_id } },
    } };
  } };
  async function upload(cardId, side, version = 1) {
    const id = randomUUID(), body = canonical({ fixture: 'synthetic queue metadata only' });
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.upload(id,card_id,request_id,actor_id,request,request_hash,side,version,plan,plan_hash)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$5,$6)`, id, cardId, randomUUID(), staff.id, body, digest(body), side, version);
    return id;
  }
  const cards = [];
  for (let index = 0; index < 50; index++) {
    const id = randomUUID(), pairId = randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)`, id, pairId, staff.id, randomUUID(), digest(id), `Synthetic ${index}`);
    const front = await upload(id, 'FRONT'), back = await upload(id, 'BACK');
    await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_intake.card SET front_upload_id=$2::uuid,back_upload_id=$3::uuid,front_version=1,back_version=1,revision=2 WHERE id=$1::uuid', id, front, back);
    cards.push({ cardId: id, sourceHash: source({ id, pair_id: pairId, front_upload_id: front, back_upload_id: back }) });
  }
  const repository = createBatchRepository({ boundary, intakeRepository }), input = { actionId: randomUUID(), cards };
  const first = await repository.enqueue(staff, input), second = await repository.enqueue(staff, input);
  assert.equal(first.jobs.length, 50); assert.deepEqual(first, second);
  await repository.enqueue(staff, { actionId: randomUUID(), cards: [...cards].reverse() });
  const [count] = await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM atlas_manual_connected.batch_grading');
  assert.equal(count.count, 50);
  await assert.rejects(repository.enqueue(staff, { ...input, cards: cards.slice(0, 1) }), error => error.code === 'BATCH_ACTION_CONFLICT');
  await assert.rejects(repository.enqueue(other, { actionId: randomUUID(), cards: cards.slice(0, 1) }), error => error.code === 'INTAKE_CARD_ACCESS_DENIED');
  await assert.rejects(repository.list({ ...staff }), error => error.code === 'SIGN_IN_REQUIRED');
  checks.push('50-card atomic admission, pair deduplication across batch actions, immutable request replay and ordinary staff handle isolation');
  assert.equal((await repository.list(staff)).jobs.length, 50); assert.equal((await repository.list(other)).jobs.length, 0);
  const claimed = await Promise.all(Array.from({ length: 4 }, () => repository.claim(staff, randomUUID(), 2)));
  assert.equal(claimed.filter(Boolean).length, 2);
  const [one, two] = claimed.filter(Boolean);
  assert.equal(await repository.renew(staff, one), true);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", one.key);
  const replacement = await repository.claim(staff, randomUUID(), 2); assert.equal(replacement.key, one.key); assert.notEqual(replacement.claimId, one.claimId);
  assert.equal(await repository.finish(staff, one, { kind: 'CONTINUE' }), false);
  assert.equal(await repository.finish(staff, replacement, { kind: 'CONTINUE', evidence: { manualRevision: 1, manualContentHash: 'a'.repeat(64) } }), true);
  assert.equal(await repository.finish(staff, two, { kind: 'ATTENTION', code: 'BATCH_ANALYSIS_UNCERTAIN' }), true);
  const attention = (await repository.list(staff)).jobs.find(job => job.key === two.key);
  const resumed = await repository.resume(staff, { key: attention.key, expectedRevision: attention.revision });
  assert.equal(resumed.job.state, 'QUEUED'); assert.equal(resumed.job.analysisActionId, attention.analysisActionId);
  await assert.rejects(repository.resume(staff, { key: attention.key, expectedRevision: attention.revision }), error => error.code === 'BATCH_RESUME_STALE');
  checks.push('shared two-worker cap, expired lease recovery, old-claim rejection and exact source/action resume');
  const reviewing = first.jobs.find(job => job.key !== one.key && job.key !== two.key);
  const manual = canonical({ source: { sourceHash: reviewing.sourceHash } }), reportHash = digest('synthetic provisional report');
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)',reviewing.cardId,manual,digest(manual),staff.id);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='REVIEW',stage='REPORT',evidence=$2 WHERE key=$1",reviewing.key,
    canonical({ reportHash,manualRevision:1,manualContentHash:digest(manual),proposedGrade:10 }));
  const reviewInput={reportHash,reviewed:true,images:{FRONT:'a'.repeat(64),BACK:'b'.repeat(64)}};
  assert.equal((await repository.readReview(staff,reviewing.key)).review,null);
  assert.deepEqual(await repository.beginReview(staff,reviewing.key,reviewInput),reviewInput);
  assert.deepEqual(await repository.beginReview(staff,reviewing.key,reviewInput),reviewInput);
  await assert.rejects(repository.beginReview(staff,reviewing.key,{...reviewInput,reportHash:'c'.repeat(64)}),e=>e.code==='BATCH_REVIEW_BINDING_CHANGED');
  await assert.rejects(repository.readReview(other,reviewing.key),e=>e.code==='BATCH_NOT_FOUND');
  await assert.rejects(fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_review SET input=input WHERE job_key=$1",reviewing.key),/immutable/i);
  const changedManual=canonical({source:{sourceHash:reviewing.sourceHash},humanStep:1});
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual.card SET revision=2,content=$2,content_hash=$3 WHERE id=$1::uuid',reviewing.cardId,changedManual,digest(changedManual));
  const interrupted=(await repository.list(staff)).jobs.find(job=>job.key===reviewing.key);
  assert.equal(interrupted.state,'REVIEW');assert.equal(interrupted.resumeAvailable,true);assert.equal(interrupted.evidence.proposedGrade,undefined);
  const approvedAction=randomUUID(), approvedRequest=canonical({fixture:'synthetic approved history ordering'}), approvedReport=canonical({fixture:'synthetic approval only'});
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result)
    VALUES($1::uuid,$2::uuid,$3::uuid,2,3,$4,$5,$5)`,reviewing.cardId,approvedAction,staff.id,digest(approvedRequest),approvedRequest);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report)
    VALUES($1::uuid,$2::uuid,$3::uuid,2,$4,$5,$6)`,reviewing.cardId,approvedAction,staff.id,digest(changedManual),digest(approvedReport),approvedReport);
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual.card SET revision=3 WHERE id=$1::uuid',reviewing.cardId);
  const ordered=(await repository.list(staff)).jobs;
  assert.equal(ordered.at(-1).key,reviewing.key);assert.equal(ordered.at(-1).state,'APPROVED','Completed history cannot crowd active cards out of the bounded queue list');
  checks.push('exact immutable human review receipt, replay conflict, other-staff denial, and partially saved review recovery without stale score');
  const changing = await repository.claim(staff, randomUUID(), 2), newFront = await upload(changing.cardId, 'FRONT', 2);
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_intake.card SET front_upload_id=$2::uuid,front_version=2,revision=revision+1 WHERE id=$1::uuid', changing.cardId, newFront);
  await assert.rejects(repository.finish(staff, changing, { kind: 'CONTINUE' }), error => error.code === 'BATCH_PHOTOS_CHANGED');
  const stale = (await repository.list(staff)).jobs.find(job => job.key === changing.key);
  assert.equal(stale.state, 'SUPERSEDED'); assert.deepEqual(stale.evidence, {});
  checks.push('source replacement refuses stale completion and removes stale score from review projection');
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='SUPERSEDED',claim_id=NULL,lease_until=NULL WHERE key=$1",changing.key);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET stage='ANALYZE',available_at=clock_timestamp() WHERE state='QUEUED'");
  const pending = await Promise.all([repository.claim(staff,randomUUID(),2),repository.claim(staff,randomUUID(),2)]);
  assert.equal(pending.filter(Boolean).length,2);
  for(const job of pending) await repository.finish(staff,job,{kind:'WAIT',retryAfterMs:60000});
  const freshRepository=createBatchRepository({boundary,intakeRepository});
  assert.equal(await freshRepository.claim(staff,randomUUID(),2),null,'Background slots remain reserved after WAIT releases both ordinary leases');
  const [reservedSlots]=await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM atlas_manual_connected.batch_grading WHERE analysis_reserved');
  assert.equal(reservedSlots.count,2);
  const waiting=pending[0], runId=randomUUID(), payload=canonical({fixture:'synthetic provider journal, no provider calls'});
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid) ON CONFLICT DO NOTHING',waiting.cardId,payload,digest(payload),staff.id);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$5,$5,$6,$6,$5,'PREPARED',clock_timestamp()+interval '4 minutes')`,runId,waiting.cardId,waiting.analysisActionId,staff.id,digest(payload),payload);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid",runId);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='NEEDS_ATTENTION',code='BATCH_ANALYSIS_UNCERTAIN' WHERE key=$1",waiting.key);
  await fixture.admin.$executeRawUnsafe("INSERT INTO atlas_defect_analysis.receipt(analysis_id,kind,request_hash,evidence) VALUES($1::uuid,'OUTCOME',$2,$3)",runId,digest(payload),canonical({state:'UNKNOWN',fixture:'synthetic uncertain receipt'}));
  assert.equal(await freshRepository.claim(staff,randomUUID(),2),null,'An unknown paid dispatch cannot release its slot');
  await fixture.admin.$executeRawUnsafe("INSERT INTO atlas_defect_analysis.receipt(analysis_id,kind,request_hash,evidence) VALUES($1::uuid,'RESPONSE',$2,$3)",runId,digest(payload),canonical({state:'REFUSED',fixture:'synthetic terminal provider receipt'}));
  const admittedAfterTerminal=await freshRepository.claim(staff,randomUUID(),2);
  assert.ok(admittedAfterTerminal && !pending.some(job=>job.key===admittedAfterTerminal.key));
  checks.push('background-analysis slots persist across WAIT and repository restart; uncertain dispatch retains slot until terminal provider receipt');
  console.log(JSON.stringify({ status: 'BATCH_POSTGRES_PASS', checks, directory: fixture.cluster.directory, realPhotographs: false, providerRequests: 0 }));
} finally { await fixture.stop(); }
