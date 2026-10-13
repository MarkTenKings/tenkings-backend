// Finite synthetic qualification. Creates and destroys its own PostgreSQL17
// instance; never accepts a database URL and never calls an external model.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {descriptorSha256,parseDecodedFrame} from '@atlas/photo-core';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createOwnedManualFixture} from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import {createIntakeRepository,intakeGrantSQL} from '@atlas/manual-intake/repository';
import {createManualIntake} from '@atlas/manual-intake';
import {createPhotoProcessor} from '@atlas/manual-intake/photo-processing';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createDetailsStore,connectedGrantSQL} from '../src/details.mjs';
import {createEarlyGeometryStore,earlyGeometryGrantSQL,recordEarlyGeometryIntent} from '../src/early-geometry-store.mjs';
import {geometryCacheInput} from '../src/early-geometry.mjs';
import {runAstraGeometry} from '../src/astra-geometry.mjs';
import {memoryPhotoStorage,sha} from '../../atlas-manual-intake/test/helpers.mjs';
import {rgb16Png} from '../../atlas-photo-runtime/test/helpers.mjs';
const output=process.env.ATLAS_GEOMETRY_JOURNAL_EVIDENCE;
assert(output&&resolve(output)===output,'Absolute owned evidence directory required');await mkdir(output,{recursive:true,mode:0o700});
let upgradeBefore;
const ledgerSQL=`SELECT migration_name,checksum,finished_at,rolled_back_at,logs,applied_steps_count FROM atlas_staff._prisma_migrations ORDER BY migration_name`;
const fixture=await createOwnedManualFixture(process.argv.slice(2),{
 beforeUpgradeFrom81:async({sql})=>{upgradeBefore=await sql(ledgerSQL);assert.equal(upgradeBefore.rows.length,81);},
 afterUpgradeTo83:async({sql,source})=>{const after=await sql(ledgerSQL);assert.equal(after.rows.length,83);assert.deepEqual(after.rows.slice(0,81),upgradeBefore.rows);await writeFile(join(output,'registered81-to83.json'),JSON.stringify({status:'REGISTERED81_TO83_PREFIX_PRESERVED',before:upgradeBefore.rows,after:after.rows,inventory:source.staffMigrations},null,2)+'\n',{mode:0o600});}
}),connection=fixture.connect();
const checks=[],record=text=>checks.push(text),migrationPaths=['20261012230000_astra_geometry_evidence','20261012231000_card_image_intake'];
try{
 for(const grants of[intakeGrantSQL,connectedGrantSQL,earlyGeometryGrantSQL])await fixture.cluster.sql(grants('atlas_fixture_manual'),[],fixture.database.name);
 const {auth,boundary,manualClient}=connection,boot=await auth.bootstrap(''),browser=`${fixture.config.cookies.browser}=${boot.browserToken}`;
 const challenge=await auth.send(browser,boot.csrf,{phone:'+12025550141',requestId:randomUUID()},'astra-geometry-journal-fixture');
 const verified=await auth.verify(browser,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'astra-geometry-journal-fixture');
 const staff=await auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`,verified.csrf);
 const principal=await boundary.transaction(staff,async({principal})=>principal),{storage}=memoryPhotoStorage();
 const repository=createIntakeRepository({boundary,keyPrefix:'intake',maxOriginalBytes:1000000,sourceCommitted:recordEarlyGeometryIntent});
 const processPhoto=createPhotoProcessor({storage,keyPrefix:'intake',decodeLimits:{maxInputBytes:1000000,maxPixels:1000000,maxRasterBytes:8000000,maxOutputBytes:1000000,timeoutMs:10000}});
 const intake=createManualIntake({repository,storage,artifacts:fixture.artifacts,processPhoto}),details=createDetailsStore({boundary,intakeRepository:repository});
 const store=createEarlyGeometryStore({boundary,intakeRepository:repository,receiptClient:manualClient});
 const engine={policy:'atlas-early-clean-geometry-v2',runtime:{identity:{sources:{},opencv:'synthetic-only'}},limits:{}},engineHash=digest(canonical(engine));
 async function newJob(){
  const createId=randomUUID(),cardId=(await intake.create(staff,{requestId:createId,label:'Disposable geometry journal proof'})).card.cardId;
  const bytes=rgb16Png(12,16),planned=await intake.plan(staff,cardId,{requestId:randomUUID(),side:'FRONT',expectedVersion:0,sha256:sha(bytes),byteCount:bytes.length});
  await storage.writeOriginal({uploadPlan:planned.upload.plan,bytes});await intake.complete(staff,cardId,planned.upload.uploadId);
  const done=await intake.prepare(staff,cardId,planned.upload.uploadId),{photo:uploaded}=await intake.readSource(staff,cardId,planned.upload.uploadId);
  const raw=await storage.readDecodedFrame({frame:uploaded.workingFrame,original:uploaded.original,decodePlan:uploaded.decodePlan});
  const cleanBytes=await sharp(raw.bytes).ensureAlpha().png().toBuffer();
  const generated=parseDecodedFrame({schemaVersion:3,kind:'decoded-frame',id:`synthetic-clean:${planned.upload.uploadId}`,
    originalDescriptorSha256:descriptorSha256(uploaded.original),decodePlanSha256:descriptorSha256(uploaded.decodePlan),
    raster:{content:{mime:'image/png',sha256:digest(cleanBytes),byteCount:cleanBytes.length},dimensions:uploaded.workingFrame.raster.dimensions,
      object:{key:`intake/derived/${cardId}/synthetic-clean.png`,versionId:null}},sourceToFrame:[1,0,0,0,1,0,0,0,1],
    treatment:{decoder:'synthetic-image-fixture',version:'fixture-v1',policyVersion:'atlas-generated-grading-image-v1',channels:4,bitDepth:8,colorSpace:'sRGB',colorTreatment:'converted',hdrTreatment:'not-present'},
    generation:{sourceFrame:uploaded.workingFrame,recipeHash:digest('synthetic-recipe'),model:'synthetic-image-fixture',promptVersion:'fixture-v1'}},uploaded.original,uploaded.decodePlan);
  const photo={...uploaded,workingFrame:generated};
  const input=geometryCacheInput(done.upload,photo,(await details.read(staff,cardId)).details,engine);
  const saved=await store.ensure(staff,input),job=await store.claim(engineHash,randomUUID());assert.equal(job.key,saved.key);
  return{cardId,createId,input,job,source:{bytes:cleanBytes,frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan}};
 }
 async function tombstone(value){const request=randomUUID();await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash) VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`,principal.id,request,digest('{}'));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,principal.id,value.createId,value.cardId,request);}
 const [permissions]=await fixture.admin.$queryRawUnsafe(`SELECT has_table_privilege('atlas_fixture_manual','atlas_manual_connected.geometry_model_action','SELECT') can_read_table,has_table_privilege('atlas_fixture_manual','atlas_manual_connected.geometry_model_action','INSERT') can_insert,has_table_privilege('atlas_fixture_manual','atlas_manual_connected.geometry_model_action','UPDATE') can_update,has_table_privilege('atlas_fixture_manual','atlas_manual_connected.geometry_model_action','DELETE') can_delete`);
 assert.deepEqual(permissions,{can_read_table:false,can_insert:false,can_update:false,can_delete:false});
 for(const signature of['read_geometry_model(text)','retry_geometry_model(text,uuid,integer)','dispatch_geometry_model(text,uuid,text,text)','receive_geometry_model(text,text,text)']){
  const [allowed]=await fixture.admin.$queryRawUnsafe(`SELECT has_function_privilege('atlas_fixture_manual',$1,'EXECUTE') allowed,EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') public_allowed`,`atlas_manual_connected.${signature}`);
  assert.deepEqual(allowed,{allowed:true,public_allowed:false});
 }
 await assert.rejects(manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.geometry_model_action'),/permission denied/);
 record('restricted worker can execute the four journal functions, cannot SELECT/INSERT/UPDATE/DELETE journal rows, and PUBLIC has no function execution');
 const one=await newJob(),requestHash=digest('one-request'),request={fixture:'request'};
 assert.equal(await store.dispatchModel({...one.job,claimId:randomUUID()},requestHash,request),false);
 const concurrent=await Promise.all([store.dispatchModel(one.job,requestHash,request),store.dispatchModel(one.job,requestHash,request)]);assert.equal(concurrent.filter(Boolean).length,1);
 assert.equal((await store.readModel(one.job)).attempt,1);assert.equal(await store.dispatchModel(one.job,requestHash,request),false);
 await store.finish(one.job,'FAILED',null,'GEOMETRY_MODEL_RESPONSE_UNKNOWN');
 await store.ensure(staff,one.input,{retry:true});const unknown=await store.claim(engineHash,randomUUID());
 assert.equal((await store.readModel(unknown)).retryAuthorized,false);assert.equal(await store.dispatchModel(unknown,requestHash,request),false);
 await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",unknown.key);
 assert(await store.saveModelResponse(unknown,requestHash,{ref:{fixture:'late-actual-response'},httpStatus:200}));
 assert(await store.saveModelResponse(unknown,requestHash,{ref:{fixture:'late-actual-response'},httpStatus:200}));
 assert.equal(await store.saveModelResponse(unknown,requestHash,{ref:{fixture:'different-response'},httpStatus:200}),false);
 await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET state='FAILED',claim_id=NULL,lease_until=NULL WHERE key=$1",unknown.key);
 record('concurrent dispatch reserves one action; wrong claim/duplicate POST denied; explicit retry cannot resend unknown; late actual receipt survives lease expiry and remains immutable/idempotent');
 const retry=await newJob(),submitted=[];let active=retry.job;
 for(let attempt=1;attempt<=3;attempt++){
  await assert.rejects(runAstraGeometry({job:active,source:retry.source,store,artifacts:fixture.artifacts,model:async request=>{submitted.push(JSON.stringify(request));return{status:429,bytes:Buffer.from('{"error":"synthetic rate limit"}')};}}),{code:'GEOMETRY_MODEL_RESPONSE_INVALID'});
  assert.equal((await store.readModel(active)).attempt,attempt);
  await store.finish(active,'FAILED',null,'GEOMETRY_MODEL_RESPONSE_INVALID');
  await assert.rejects(runAstraGeometry({job:active,source:retry.source,store,artifacts:fixture.artifacts,model:()=>assert.fail('Automatic recovery must not POST')}),{code:'GEOMETRY_MODEL_RESPONSE_INVALID'});
  if(attempt<3){await store.ensure(staff,retry.input,{retry:true});active=await store.claim(engineHash,randomUUID());assert((await store.readModel(active)).retryAuthorized);}
 }
 await store.ensure(staff,retry.input,{retry:true});active=await store.claim(engineHash,randomUUID());
 assert.equal((await store.readModel(active)).retryAuthorized,false);
 assert.equal(await store.dispatchModel(active,digest(submitted[0]),{fixture:'fourth-forbidden'}),false);
 await store.finish(active,'FAILED',null,'GEOMETRY_MODEL_RESPONSE_INVALID');assert.equal(new Set(submitted).size,1);
 const rows=await fixture.admin.$queryRawUnsafe('SELECT attempt,request_hash,response FROM atlas_manual_connected.geometry_model_action WHERE job_key=$1 ORDER BY attempt',retry.job.key);
 assert.deepEqual(rows.map(r=>r.attempt),[1,2,3]);assert(rows.every(r=>JSON.parse(r.response).httpStatus===429));
 record('real store + immutable artifacts: explicit retry after definite429 creates bounded successors1–3, resubmits byte-identical original request, keeps all prior receipts, and denies fourth dispatch');
 const discarded=await newJob();await tombstone(discarded);assert.equal(await store.dispatchModel(discarded.job,digest('discard'),request),false);
 await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET state='FAILED',claim_id=NULL,lease_until=NULL WHERE key=$1",discarded.job.key);
 record('discarded-card tombstone after CPU claim but before paid dispatch prevents any geometry model action');
 const paid=await newJob(),paidHash=digest('paid-before-discard');assert(await store.dispatchModel(paid.job,paidHash,request));await tombstone(paid);
 assert(await store.saveModelResponse(paid.job,paidHash,{ref:{fixture:'after-discard'},httpStatus:429}));
 await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET state='FAILED',claim_id=NULL,lease_until=NULL WHERE key=$1",paid.job.key);
 const [refused]=await manualClient.$queryRawUnsafe('SELECT atlas_manual_connected.retry_geometry_model($1,$2::uuid,$3::integer) authorized',paid.job.key,principal.id,principal.accessVersion);assert.equal(refused.authorized,false);
 record('discard after paid dispatch retains its real receipt but cannot authorize a successor or resurrect human/card state');
 const historical=await newJob();await store.finish(historical.job,'FAILED',null,'GEOMETRY_PROCESSING_FAILED');
 const updated={...historical.input,engine:{...engine,visual:'new-astra-only'},engineHash:digest(canonical({...engine,visual:'new-astra-only'}))};
 const historicalBefore=await store.read(staff,historical.cardId,historical.job.key);
 const discovered=await store.pending(updated.engineHash,null,32);assert(discovered.some(row=>row.upload_id===historical.input.uploadId&&row.previous_engine===true));
 assert.equal(await store.ensure(staff,updated),null);const updatedKey=digest(canonical(updated));
 assert.equal((await store.read(staff,historical.cardId,updatedKey,updated)).error,'GEOMETRY_REFRESH_AVAILABLE');
 await store.ensure(staff,updated,{retry:true});const refreshed=await store.claim(updated.engineHash,randomUUID());assert.equal(refreshed.key,updatedKey);
 assert.deepEqual(await store.read(staff,historical.cardId,historical.job.key),historicalBefore);await store.finish(refreshed,'FAILED',null,'GEOMETRY_PROCESSING_FAILED');
 record('runtime engine changes do not enqueue historical uploads implicitly; discovery preserves pagination with a skip marker, explicit human refresh creates Astra job, original stored geometry remains byte-identical');
 const revoked=await newJob();await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "revokedAt"=clock_timestamp(),"accessVersion"="accessVersion"+1 WHERE id=$1::uuid',principal.id);
 assert.equal(await store.dispatchModel(revoked.job,digest('revoked'),request),false);
 await assert.rejects(store.ensure(staff,revoked.input,{retry:true}),e=>e.code==='SIGN_IN_REQUIRED');
 record('revoked reviewer/accessVersion blocks paid dispatch even with existing lease; expired authenticated retry is refused');
 const [counts]=await fixture.admin.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM atlas_manual.card) cards,(SELECT count(*)::int FROM atlas_manual.approval) approvals');assert.deepEqual(counts,{cards:0,approvals:0});
 const migrations=await Promise.all(migrationPaths.map(async name=>({name,sha256:digest(await readFile(new URL('../../../frontend/atlas-app/prisma/migrations/'+name+'/migration.sql',import.meta.url)))})));
 const evidence={status:'ASTRA_GEOMETRY_POSTGRES_PASS',fixtureDirectory:fixture.cluster.directory,database:fixture.database.name,externalProviderCalls:0,syntheticModelCalls:submitted.length,productionDataEffects:false,migrations,checks};
 await writeFile(join(output,'astra-geometry-postgres.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));
}finally{await connection.close();await fixture.stop();await writeFile(join(output,'cleanup.json'),await readFile(join(fixture.cluster.directory,'cleanup.json')),{mode:0o600});}
