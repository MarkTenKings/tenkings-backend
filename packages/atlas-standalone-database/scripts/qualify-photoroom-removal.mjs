// Finite nonce-owned PostgreSQL fixture. No serving database or provider access.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../migrate.mjs';
import { registeredMigrations } from '../registered-migrations.mjs';
import { standaloneRoleSQL } from '../grants.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { createReportImageStore } from '../../atlas-connected-manual/src/report-image-store.mjs';
import { REPORT_IMAGE_RECIPE } from '../../atlas-connected-manual/src/report-image-provider.mjs';
import { validateReportImageRuntimeConfiguration } from '../../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';

const args=process.argv.slice(2),output=process.env.ATLAS_PHOTOROOM_SCHEMA_EVIDENCE;
assert(output && resolve(output)===output);await mkdir(output,{recursive:true,mode:0o700});
const {Client}=createRequire(import.meta.url)(args[args.indexOf('--pg-module')+1]);
const cluster=await disposablePostgres(args),clients=[],checks=[];let evidence;
const connect=async(role,password)=>{const url=new URL(cluster.url('atlas_photoroom'));if(role){url.username=role;url.password=password;}const c=new Client({connectionString:url.href});await c.connect();clients.push(c);return c;};
try {
 await cluster.sql('CREATE DATABASE atlas_photoroom');const admin=await connect();
 assert.equal((await applyStandaloneBaseline(admin)).status,'APPLIED');
 const migrations=await registeredMigrations(),cutover=migrations.find(m=>m.version==='atlas-standalone-005-photoroom-removal');assert(cutover);
 // Build the actual predecessor schema first so historical retry/output rows
 // exist before the new fence. No production snapshot or credentials are used.
 for(const m of migrations.filter(m=>m!==cutover)){await admin.query('BEGIN');await admin.query(m.sql);await admin.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)',[m.version,m.sqlSha256]);await admin.query('COMMIT');}
 const ledgerBefore=(await admin.query('SELECT * FROM atlas_staff._standalone_migrations ORDER BY version')).rows;
 const roles={staff:'atlas_photo_staff',manual:'atlas_photo_main',variant:'atlas_photo_worker',customer:'atlas_photo_customer',customerPrivate:'atlas_photo_private'};
 await admin.query(standaloneRoleSQL(roles));const password=randomBytes(24).toString('hex');await admin.query(`ALTER ROLE ${roles.manual} LOGIN PASSWORD '${password}'`);
 const main=await connect(roles.manual,password),concurrent=await connect(roles.manual,password),actor=randomUUID(),other=randomUUID();
 const runtimeClient={$queryRawUnsafe:async(sql,...values)=>(await main.query(sql,values)).rows};
 assert.equal((await admin.query("SELECT has_table_privilege($1,'atlas_staff._standalone_migrations','SELECT') allowed",[roles.manual])).rows[0].allowed,false);
 await assert.rejects(validateReportImageRuntimeConfiguration({enabled:true,client:runtimeClient}),{code:'REPORT_IMAGE_SCHEMA_REQUIRED'});
 for(const id of [actor,other])await admin.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",role) VALUES($1,$2,\'REVIEWER\')',[id,digest(id)]);
 const legacy={version:'synthetic-legacy-recipe',execution:'OPENAI_IMAGES_API',model:'historical-fixture-model',promptVersion:'historical-fixture-prompt',prompt:'Historical synthetic request evidence only.'};
 const photo={version:'synthetic-photoroom-recipe',execution:'PHOTOROOM_PLUS_API'};
 const row=async key=>(await admin.query('SELECT * FROM atlas_manual_connected.report_image_job WHERE key=$1',[key])).rows[0];
 const allRows=async()=>(await admin.query('SELECT * FROM atlas_manual_connected.report_image_job ORDER BY key')).rows;
 async function seed({state='FAILED',recipe=legacy,side='BACK',cardId=null,client=admin,mode='LOCAL_FIXTURE'}={}){
  const card=cardId??randomUUID(),upload=randomUUID(),sourceHash=digest(card+upload),originalHash=digest(upload),key=digest(card+upload+'job'),failed=randomUUID(),recipeText=canonical(recipe),recipeHash=digest(recipeText);
  if(!cardId)await admin.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,\'Synthetic Photoroom cutover\')',[card,randomUUID(),actor,randomUUID(),digest(card)]);
  const text='{}',plan=canonical({expected:{sha256:originalHash}});
  await admin.query(`INSERT INTO atlas_manual_intake.upload(id,card_id,request_id,actor_id,request,request_hash,side,version,plan,plan_hash,verification,verification_hash,source,source_hash)
   VALUES($1,$2,$3,$4,$5,$6,$9,1,$7,$8,$5,$6,$5,$6)`,[upload,card,randomUUID(),actor,text,digest(text),plan,digest(plan),side]);
  await admin.query(`UPDATE atlas_manual_intake.card SET ${side==='FRONT'?'front':'back'}_upload_id=$2,${side==='FRONT'?'front':'back'}_version=1,revision=revision+1 WHERE id=$1`,[card,upload]);
  const media=canonical({frame:{raster:{content:{sha256:sourceHash}}},original:{uploadId:upload,binding:{cardId:card,side},content:{sha256:originalHash}}});
  const receipt={status:400,execution:legacy.execution,model:legacy.model,promptVersion:legacy.promptVersion,promptSha256:digest(legacy.prompt),sourceSha256:sourceHash,recipeHash,clientRequestId:failed};
  const audit=state==='QUEUED'||state==='RUNNING'?[]:state==='REQUESTED'?[{event:'REQUESTED',requestId:failed}]:[{event:'REQUESTED',requestId:failed},{event:'RESPONSE',requestId:failed,receipt},{event:state,requestId:failed,code:'REPORT_IMAGE_REQUEST_REJECTED',receipt}];
  const result=state==='READY'?canonical({historical:true}):null,claimed=['RUNNING','REQUESTED'].includes(state);
  await client.query(`INSERT INTO atlas_manual_connected.report_image_job(key,source_hash,recipe_hash,recipe,mode,source_card_id,source_media,source_media_hash,state,attempts,audit,code,result,result_hash,claim_id,lease_until)
   VALUES($1,$2,$3,$4,$15,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $14::uuid IS NULL THEN NULL ELSE clock_timestamp()+interval '5 minutes' END)`,
   [key,sourceHash,recipeHash,recipeText,card,media,digest(media),state,state==='QUEUED'?0:1,JSON.stringify(audit),state==='FAILED'?'REPORT_IMAGE_REQUEST_REJECTED':null,result,result?digest(result):null,claimed?failed:null,mode]);
  await admin.query('INSERT INTO atlas_manual_connected.card_image_intent(upload_id,card_id,mode) VALUES($1,$2,$3)',[upload,card,mode]);
  await admin.query('INSERT INTO atlas_manual_connected.card_image_binding(upload_id,card_id,side,original_sha256,job_key) VALUES($1,$2,$3,$4,$5)',[upload,card,side,originalHash,key]);
  return {card,upload,key,failed,receipt,args:[actor,1,randomUUID(),card,upload,side,key,failed,recipeHash]};
 }
 const call=(client,values)=>client.query('SELECT atlas_manual_connected.retry_report_image($1,$2,$3,$4,$5,$6,$7,$8,$9) receipt',values);
 const retried=await seed(),historicalReceipt=(await call(main,retried.args)).rows[0].receipt;
 const ready=await seed({state:'READY',side:'FRONT',cardId:retried.card}),failed=await seed(),pending=[];
 for(const state of ['QUEUED','RUNNING','REQUESTED'])pending.push(await seed({state}));
 const foreignExpired=await seed({state:'RUNNING',mode:'PRODUCTION'}),foreignLive=await seed({state:'REQUESTED',mode:'PRODUCTION'});
 await admin.query("UPDATE atlas_manual_connected.report_image_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",[foreignExpired.key]);
 const document='{"fixture":"retained human work"}',action=randomUUID();
 await admin.query('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,$2,$3,$4)',[retried.card,document,digest(document),actor]);
 await admin.query('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,1,2,$4,$5,$5)',[retried.card,action,actor,digest(document),document]);
 await admin.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1,$2,$3,1,$4,$4,$5)',[retried.card,action,actor,digest(document),document]);
 const preserved=async()=>{const result={};for(const table of ['atlas_manual.card','atlas_manual.action','atlas_manual.approval','atlas_manual_intake.card','atlas_manual_intake.upload','atlas_manual_connected.card_image_binding'])result[table]=digest(JSON.stringify((await admin.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));return result;};
 const before=await allRows(),preservedBefore=await preserved();
 assert.deepEqual((await applyStandaloneMigrations(admin)).applied,[{version:cutover.version,checksum:cutover.sqlSha256}]);
 assert.deepEqual(await allRows(),before);assert.deepEqual(await preserved(),preservedBefore);
 await validateReportImageRuntimeConfiguration({enabled:true,client:runtimeClient});
 await admin.query('ALTER TABLE atlas_manual_connected.report_image_job DISABLE TRIGGER report_image_provider_admission');
 await assert.rejects(validateReportImageRuntimeConfiguration({enabled:true,client:runtimeClient}),{code:'REPORT_IMAGE_SCHEMA_REQUIRED'});
 await admin.query('ALTER TABLE atlas_manual_connected.report_image_job ENABLE TRIGGER report_image_provider_admission');
 const guardDefinition=(await admin.query("SELECT pg_get_functiondef('atlas_manual_connected.report_image_guard()'::regprocedure) definition")).rows[0].definition;
 await admin.query("CREATE OR REPLACE FUNCTION atlas_manual_connected.report_image_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS 'BEGIN RETURN NEW; END'");
 await assert.rejects(validateReportImageRuntimeConfiguration({enabled:true,client:runtimeClient}),{code:'REPORT_IMAGE_SCHEMA_REQUIRED'});
 await admin.query(guardDefinition);await validateReportImageRuntimeConfiguration({enabled:true,client:runtimeClient});
 checks.push('runtime main role lacks migration-ledger access but exact005 pg_catalog gate passes;003, disabled trigger and altered function fail closed');
 assert.equal((await applyStandaloneMigrations(admin)).status,'NO_OP');assert.equal((await applyStandaloneBaseline(admin)).status,'NO_OP');
 assert.deepEqual((await admin.query('SELECT * FROM atlas_staff._standalone_migrations WHERE version<>$1 ORDER BY version',[cutover.version])).rows,ledgerBefore);
 checks.push('004→005 changes no saved image/job, source, card, action, approval or prior ledger row; repeated deploy is no-op');
 const signature='atlas_manual_connected.retry_report_image(uuid,integer,uuid,uuid,uuid,text,text,uuid,text)';
 for(const role of Object.values(roles))assert.equal((await admin.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed,role===roles.manual);
 await main.query('BEGIN READ ONLY');assert.deepEqual((await call(main,retried.args)).rows[0].receipt,historicalReceipt);await main.query('ROLLBACK');
 const [one,two]=await Promise.all([call(main,retried.args),call(concurrent,retried.args)]);assert.deepEqual(one.rows,two.rows);assert.deepEqual(await allRows(),before);
 checks.push('main-only historical exact retry acknowledgement works in READ ONLY and concurrent transactions with zero job mutation');
 for(const[index,value]of [[0,other],[1,2],[3,randomUUID()],[4,randomUUID()],[5,'FRONT'],[7,randomUUID()],[8,digest('wrong recipe')]])await assert.rejects(call(main,retried.args.map((v,i)=>i===index?value:v)),/ACCESS_DENIED|UNAVAILABLE|CONFLICT/);
 await assert.rejects(call(main,failed.args),/UNAVAILABLE/);await assert.rejects(call(main,retried.args.map((v,i)=>i===2?randomUUID():v)),/UNAVAILABLE/);
 await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET state='QUEUED' WHERE key=$1",[failed.key]),/immutable/);
 await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET audit=audit||'[{\"event\":\"RETRY_REQUESTED\"}]'::jsonb WHERE key=$1",[failed.key]),/immutable/);
 checks.push('wrong actor/access/card/upload/side/failed request/recipe, new retry IDs, forged retry audit and terminal requeue all rejected');
 await assert.rejects(seed({state:'QUEUED',client:main}),/PROVIDER_RETIRED_OR_ADMISSION_INVALID/);
 // Rejected seed inserts only fixture intake metadata before the image fence.
 const preservationAfterRejectedSeed=await preserved();
 for(const item of pending){const old=await row(item.key);
  await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET state='READY',result='{}',result_hash=$2 WHERE key=$1",[item.key,digest('{}')]),/PROVIDER_RETIRED/);
  await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET state='REQUESTED',audit=audit||'[{\"event\":\"REQUESTED\"}]'::jsonb WHERE key=$1",[item.key]),/PROVIDER_RETIRED/);
  await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET state='RUNNING',attempts=attempts+1 WHERE key=$1",[item.key]),/PROVIDER_RETIRED/);
  assert.deepEqual(await row(item.key),old);
  const state=old.state==='REQUESTED'?'UNKNOWN':'FAILED';await main.query("UPDATE atlas_manual_connected.report_image_job SET state=$2,code='REPORT_IMAGE_PROVIDER_RETIRED',claim_id=NULL,lease_until=NULL,audit=audit||jsonb_build_array(jsonb_build_object('event',$2::text)),updated_at=clock_timestamp() WHERE key=$1",[item.key,state]);
  const retired=await row(item.key);await main.query("UPDATE atlas_manual_connected.report_image_job SET audit=audit||jsonb_build_array(jsonb_build_object('event','RESPONSE','requestId',$2::text,'receipt',$3::jsonb)),updated_at=clock_timestamp() WHERE key=$1",[item.key,item.failed,JSON.stringify({status:200,execution:'OPENAI_IMAGES_API',outputSha256:digest('late discarded pixels')})]);
  const late=await row(item.key);assert.equal(late.state,state);assert.equal(late.result,null);assert.equal(late.audit.length,retired.audit.length+1);
 }
 assert.deepEqual(await row(ready.key),before.find(j=>j.key===ready.key));assert.deepEqual(await preserved(),preservationAfterRejectedSeed);
 checks.push('old insertion/claim/dispatch/late READY blocked; queued/running→FAILED, requested→UNKNOWN and late RESPONSE receipts accepted; old READY unchanged');
 const fresh=await seed({state:'QUEUED',recipe:photo,client:main}),claim=randomUUID();
 await main.query("UPDATE atlas_manual_connected.report_image_job SET state='RUNNING',attempts=1,claim_id=$2,lease_until=clock_timestamp()+interval '5 minutes' WHERE key=$1",[fresh.key,claim]);
 await main.query("UPDATE atlas_manual_connected.report_image_job SET state='REQUESTED',audit=audit||jsonb_build_array(jsonb_build_object('event','REQUESTED','requestId',$2::text)) WHERE key=$1",[fresh.key,claim]);
 await main.query("UPDATE atlas_manual_connected.report_image_job SET state='READY',result='{}',result_hash=$2,claim_id=NULL,lease_until=NULL,audit=audit||'[{\"event\":\"READY\"}]'::jsonb WHERE key=$1",[fresh.key,digest('{}')]);
 assert.equal((await row(fresh.key)).state,'READY');
 await assert.rejects(main.query("UPDATE atlas_manual_connected.report_image_job SET state='QUEUED' WHERE key=$1",[fresh.key]),/immutable/);
 await assert.rejects(admin.query('DELETE FROM atlas_manual_connected.report_image_job WHERE key=$1',[ready.key]),/retained/);
 checks.push('sole Photoroom admission→claim→dispatch→READY succeeds, completed frame remains immutable, historical deletion refused');
 const foreignBefore=await Promise.all([row(foreignExpired.key),row(foreignLive.key)]);
 const eligible=await seed({state:'QUEUED',recipe:REPORT_IMAGE_RECIPE,client:main});
 const store=createReportImageStore({boundary:{async machineTransaction(_staff,work){await main.query('BEGIN');try{const value=await work({principal:{mode:'LOCAL_FIXTURE'},tx:{$queryRawUnsafe:async(sql,...values)=>(await main.query(sql,values)).rows,$executeRawUnsafe:async(sql,...values)=>(await main.query(sql,values)).rowCount}});await main.query('COMMIT');return value;}catch(error){await main.query('ROLLBACK');throw error;}}}});
 const claimed=await store.claim(1);assert.equal(claimed?.key,eligible.key);assert.equal(claimed.state,'RUNNING');assert.equal(claimed.attempts,1);
 assert.deepEqual(await Promise.all([row(foreignExpired.key),row(foreignLive.key)]),foreignBefore);
 assert.equal((await row(retried.key)).state,'FAILED');assert.equal((await row(retried.key)).code,'REPORT_IMAGE_PROVIDER_RETIRED');
 assert.equal(await store.claim(1),null);
 assert.deepEqual(await Promise.all([row(foreignExpired.key),row(foreignLive.key)]),foreignBefore);
 checks.push('real claim retires only same-mode legacy jobs; foreign expired lease remains byte-identical and foreign live lease cannot consume current concurrency');
 evidence={status:'PHOTOROOM_REMOVAL_POSTGRES_PASS',groups:checks.length,checks,ledger:(await admin.query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version')).rows,migrationSha256:cutover.sqlSha256,providerCalls:0,productionQueries:0,fixtureDirectory:cluster.directory};
}finally{for(const client of clients.reverse())await client.end().catch(()=>{});await cluster.stop();}
evidence.cleanup=JSON.parse(await readFile(resolve(cluster.directory,'cleanup.json'),'utf8'));assert.equal(evidence.cleanup.stoppedVerified,true);
await writeFile(resolve(output,'result.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));
