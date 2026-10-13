// Owned disposable PostgreSQL only. Synthetic immutable HTTP receipts; no
// provider calls, photographs, human grading decisions or production URLs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest, requireThat } from '../../atlas-manual-service/src/contract.mjs';
import { intakeGrantSQL } from '../../atlas-manual-intake/src/repository.mjs';
import { BATCH_POLICY, batchAnalysisActionId } from '../src/index.mjs';
import { createBatchRepository, batchGrantSQL } from '../src/repository.mjs';

const qualificationScriptSha256 = digest(readFileSync(new URL(import.meta.url)));
const functionSnapshot = async sql => (await sql(`SELECT
  encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS definition_sha256,
  encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256,
  p.proowner,pg_get_userbyid(p.proowner) AS owner,p.proacl,p.prosecdef,p.proconfig,
  (SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
    'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgfoid=p.oid) AS triggers
  FROM pg_proc p WHERE p.oid='atlas_manual_connected.guard_batch_analysis_successor()'::regprocedure`)).rows[0];
const fixture = await createOwnedManualFixture(process.argv.slice(2)), checks = [];
let fixtureSQL;
try {
  // Use one owned synthetic admin connection for the many receipt assertions.
  // The fixture already validates the explicit pg module and creates this URL.
  const { Client } = createRequire(import.meta.url)(process.argv[process.argv.indexOf('--pg-module')+1]);
  fixtureSQL = new Client({ connectionString: fixture.database.adminUrl, connectionTimeoutMillis: 5000 });
  await fixtureSQL.connect();
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql('GRANT USAGE ON SCHEMA atlas_manual_connected TO atlas_fixture_manual', [], fixture.database.name);
  await fixture.cluster.sql(batchGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary } = fixture.connect({ manualConnectionLimit: 1 });
  const browser = await auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${browser.browserToken}`;
  const challenge = await auth.send(cookie, browser.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'transient-retry-fixture');
  const verified = await auth.verify(cookie, browser.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'transient-retry-fixture');
  const staff = await auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  const pairs = new Map();
  const intakeRepository = { async authorizeInTransaction(tx, principal, id) {
    const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_intake.card WHERE id=$1::uuid', id);
    requireThat(row?.owner_id === principal.id && principal.role === 'REVIEWER', 403, 'INTAKE_CARD_ACCESS_DENIED');
    return pairs.get(id);
  } };
  const repository = () => createBatchRepository({ boundary, intakeRepository });
  const sql = (query, values = []) => fixtureSQL.query(query, values);
  const protectedRows = async () => (await sql(`SELECT jsonb_build_object(
    'cards',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM atlas_manual.card m),
    'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM atlas_manual_connected.batch_grading j),
    'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM atlas_defect_analysis.run r),
    'receipts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY analysis_id,kind) FROM atlas_defect_analysis.receipt p),
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY analysis_id,kind) FROM atlas_defect_analysis.provider_event e)) AS value`)).rows[0].value;
  async function seed() {
    const cardId = randomUUID(), sourceHash = digest(cardId), uploads = { FRONT: randomUUID(), BACK: randomUUID() };
    const text = canonical({ fixture: 'synthetic retry evidence', source: { sourceHash } });
    await sql(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1,$2,$3,$4,$5,'Synthetic transient retry')`, [cardId, randomUUID(), staff.id, randomUUID(), digest(text)]);
    for (const side of ['FRONT','BACK']) await sql(`INSERT INTO atlas_manual_intake.upload(id,card_id,request_id,actor_id,request,request_hash,side,version,plan,plan_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$5,$6)`, [uploads[side], cardId, randomUUID(), staff.id, text, digest(text), side]);
    await sql('UPDATE atlas_manual_intake.card SET front_upload_id=$2,back_upload_id=$3,front_version=1,back_version=1,revision=2 WHERE id=$1', [cardId, uploads.FRONT, uploads.BACK]);
    await sql('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,$2,$3,$4)', [cardId, text, digest(text), staff.id]);
    pairs.set(cardId, { cardId, ready:true, sourceHash, label:'Synthetic transient retry', sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{upload:{uploadId:uploads[side]}}])) });
    const { jobs } = await repository().enqueue(staff,{actionId:randomUUID(),cards:[{cardId,sourceHash}]});
    const job = jobs[0];
    assert.equal(job.key, digest(canonical([BATCH_POLICY,cardId,sourceHash])));
    await sql("UPDATE atlas_manual_connected.batch_grading SET stage='ANALYZE',evidence=$2 WHERE key=$1", [job.key,canonical({manualRevision:1,manualContentHash:digest(text)})]);
    return arm(job.key);
  }
  async function arm(key) {
    const claimId = randomUUID();
    await sql("UPDATE atlas_manual_connected.batch_grading SET state='RUNNING',claim_id=$2,lease_until=clock_timestamp()+interval '2 minutes',analysis_reserved=true WHERE key=$1",[key,claimId]);
    const { job } = await repository().readReview(staff,key); return {...job,claimId};
  }
  async function receipt(job, {httpStatus=500,state='REFUSED',responseId=null,accepted=false,kind='RESPONSE',code='DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR'}={}) {
    const id=randomUUID(), payload=canonical({fixture:'synthetic provider request'}), hash=digest(payload);
    await sql(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$5,$5,$6,$6,$5,'PREPARED',clock_timestamp()+interval '4 minutes')`,[id,job.cardId,job.analysisActionId,staff.id,hash,payload]);
    await sql("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1",[id]);
    const evidence=canonical({state,responseRef:kind==='RESPONSE'?{fixture:true}:null,resultRef:null,responseHash:kind==='RESPONSE'?hash:null,
      providerRequestId:'req_synthetic',responseId,httpStatus,usage:null,code});
    await sql('SELECT atlas_defect_analysis.append_receipt($1,$2,$3,$4)',[id,hash,kind,evidence]);
    if(accepted) {
      const data=canonical({fixture:'synthetic retained acceptance'});
      await sql(`INSERT INTO atlas_defect_analysis.provider_event(analysis_id,kind,request_hash,provider_binding_hash,response_id,evidence,evidence_hash)
        VALUES($1,'ACCEPTED',$2,$2,$3,$4,$5)`,[id,hash,`resp_${id.replaceAll('-','')}`,data,digest(data)]);
    }
    return id;
  }
  async function forceSuccessor(job, attempt=(job.analysisAttempt??0)+1, delay=30) {
    const evidence=canonical({...job.evidence,analysisActions:[...(job.evidence.analysisActions??[]),job.analysisActionId]});
    return sql(`UPDATE atlas_manual_connected.batch_grading SET state='QUEUED',claim_id=NULL,lease_until=NULL,analysis_reserved=false,
      analysis_action_id=$2,analysis_attempt=$3,evidence=$4,available_at=clock_timestamp()+$5::integer*interval '1 second' WHERE key=$1`,
      [job.key,attempt<=3?batchAnalysisActionId(job.key,attempt):randomUUID(),attempt,evidence,delay]);
  }
  const first=await seed();await receipt(first);
  const guardBefore=await functionSnapshot(sql);
  for(const httpStatus of [429,500,502,503,504]) {
    const job=httpStatus===500?first:await seed();if(job!==first)await receipt(job,{httpStatus});
    const before=await protectedRows();
    assert.equal(await repository().finish(staff,job,{kind:'RETRY_ANALYSIS',code:'DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR'}),true);
    const current=(await repository().readReview(staff,job.key)).job;
    assert.equal(current.analysisAttempt,1);assert.equal(current.analysisActionId,batchAnalysisActionId(job.key,1));
    assert.deepEqual(current.evidence.analysisActions,[job.analysisActionId]);
    const after=await protectedRows();for(const field of ['cards','runs','receipts','events'])assert.deepEqual(after[field],before[field]);
    const delay=(await sql('SELECT extract(epoch from available_at-clock_timestamp())::float AS seconds FROM atlas_manual_connected.batch_grading WHERE key=$1',[job.key])).rows[0].seconds;
    assert(delay>25&&delay<=30);
  }
  console.error('Owned PostgreSQL: behavioral group complete.');
  checks.push('all five exact definite refusal statuses allocate one durable successor with 30-second delay and preserve card/paid history');
  let chain=await seed();
  for(let attempt=1;attempt<=3;attempt++) {
    await receipt(chain,{httpStatus:[500,502,503][attempt-1]});
    assert.equal(await repository().finish(staff,chain,{kind:'RETRY_ANALYSIS'}),true);
    const current=(await repository().readReview(staff,chain.key)).job;
    assert.equal(current.analysisAttempt,attempt);assert.deepEqual(current.evidence.analysisActions,Array.from({length:attempt},(_,i)=>batchAnalysisActionId(chain.key,i)));
    const delay=(await sql('SELECT extract(epoch from available_at-clock_timestamp())::float AS seconds FROM atlas_manual_connected.batch_grading WHERE key=$1',[chain.key])).rows[0].seconds;
    assert(delay>(attempt===1?25:55)&&delay<=(attempt===1?30:60));chain=await arm(chain.key);
  }
  await receipt(chain,{httpStatus:504});
  await assert.rejects(repository().finish(staff,chain,{kind:'RETRY_ANALYSIS'}),{code:'BATCH_RATE_LIMIT_RETRY_EXHAUSTED'});
  await assert.rejects(forceSuccessor(chain,4), /BATCH_RATE_LIMIT_RETRY_UNPROVEN/);
  console.error('Owned PostgreSQL: behavioral group complete.');
  checks.push('repository reconstruction preserves retry lineage, 30/60/60 backoff and strict three-successor maximum in app and trigger');
  for(const variant of [{httpStatus:400},{httpStatus:501},{httpStatus:505},{responseId:'resp_retained'},
    {state:'UNKNOWN'},{accepted:true},{kind:'OUTCOME',state:'UNKNOWN',httpStatus:null,code:'DEFECT_ANALYSIS_OUTCOME_UNKNOWN'},
    {code:'DEFECT_ANALYSIS_PROVIDER_REFUSAL'}]) {
    const job=await seed();await receipt(job,variant);const before=await protectedRows();
    await assert.rejects(repository().finish(staff,job,{kind:'RETRY_ANALYSIS'}),{code:'BATCH_RATE_LIMIT_RETRY_UNPROVEN'});
    await assert.rejects(forceSuccessor(job), /BATCH_RATE_LIMIT_RETRY_UNPROVEN/);assert.deepEqual(await protectedRows(),before);
  }
  console.error('Owned PostgreSQL: behavioral group complete.');
  checks.push('nonallowlisted HTTP, response ID, UNKNOWN/transport outcome, ACCEPTED and non-HTTP refusal cannot allocate a successor even via direct SQL');
  const short=await seed();await receipt(short);
  await assert.rejects(forceSuccessor(short,1,0),/BATCH_RATE_LIMIT_RETRY_BINDING_INVALID/);
  await sql("UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",[short.key]);
  await assert.rejects(forceSuccessor(short),/BATCH_RATE_LIMIT_RETRY_UNPROVEN/);
  console.error('Owned PostgreSQL: behavioral group complete.');
  checks.push('database backoff and expired-lease guards remain enforced');
  await sql("UPDATE atlas_manual_connected.batch_grading SET state='SUPERSEDED',claim_id=NULL,lease_until=NULL,analysis_reserved=false");
  let editedTerminalKey;
  for(const change of ['manual','review','none']) {
    const job=await seed();await receipt(job);
    await sql("UPDATE atlas_manual_connected.batch_grading SET state='NEEDS_ATTENTION',claim_id=NULL,lease_until=NULL,code='DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR' WHERE key=$1",[job.key]);
    if(change==='manual') {const text=canonical({fixture:'human edit retained'});await sql('UPDATE atlas_manual.card SET revision=revision+1,content=$2,content_hash=$3 WHERE id=$1',[job.cardId,text,digest(text)]);}
    if(change==='review') {const text=canonical({fixture:'human review started'});await sql('INSERT INTO atlas_manual_connected.batch_review(job_key,actor_id,input,input_hash) VALUES($1,$2,$3,$4)',[job.key,staff.id,text,digest(text)]);}
    if(change==='manual')editedTerminalKey=job.key;
    if(change==='none') {
      // A separate terminal job still holds the only slot, while this eligible
      // refused job has no reservation (the saved Reshiram/Pikachu shape).
      await sql('UPDATE atlas_manual_connected.batch_grading SET analysis_reserved=(key=$1) WHERE key IN ($1,$2)',[editedTerminalKey,job.key]);
    }
    const claimed=await repository().claim(staff,randomUUID(),1,1);
    if(change==='none')assert.equal((await sql('SELECT analysis_reserved FROM atlas_manual_connected.batch_grading WHERE key=$1',[editedTerminalKey])).rows[0].analysis_reserved,false);
    const reservation=(await sql('SELECT analysis_reserved FROM atlas_manual_connected.batch_grading WHERE key=$1',[job.key])).rows[0];
    assert.equal(reservation.analysis_reserved,change==='none');
    if(change==='none')assert.equal(claimed?.key,job.key);else assert.equal(claimed,null);
    await sql("UPDATE atlas_manual_connected.batch_grading SET state='SUPERSEDED',claim_id=NULL,lease_until=NULL WHERE key=$1",[job.key]);
  }
  console.error('Owned PostgreSQL: behavioral group complete.');
  checks.push('concurrency1 clears terminal reservations and reclaims only unchanged unreviewed refused work; human edits and begun reviews remain untouched');
  assert.deepEqual(await functionSnapshot(sql),guardBefore);
  console.log(JSON.stringify({status:'BATCH_TRANSIENT_RETRY_POSTGRES_PASS',checks,schemaMode:'standalone',schemaSource:fixture.cluster.source,
    qualificationScriptSha256,directory:fixture.cluster.directory,providerRequests:0,realPhotographs:false}));
} finally { try { await fixtureSQL?.end(); } finally { await fixture.stop(); } }
