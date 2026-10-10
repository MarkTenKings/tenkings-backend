// Owned disposable PostgreSQL only. Synthetic provider GETs; no production I/O.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createAnalysisRepository } from '../../atlas-defect-analysis/src/repository.mjs';
import { createAnalysisExecutor, storeAnalysisRequest } from '../../atlas-defect-analysis/src/executor.mjs';
import { createAstraDefectProvider } from '../../atlas-defect-analysis/src/provider.mjs';
import { buildAstraContextBackgroundDefectRequest } from '../../atlas-defect-analysis/src/index.mjs';
import { contextInputFixture, responseFixture, outputFixture } from '../../atlas-defect-analysis/test/fixtures.mjs';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createVariantAdmission } from '../src/variant-admission.mjs';
import { createVariantWorkers } from './variant-workers.mjs';
import { variantWorkerRoleSQL, variantWorkerGrantSQL, VARIANT_WORKER_FORBIDDEN_WRITES } from '../src/variant-worker-grants.mjs';
const output=process.env.ATLAS_VARIANT_BACKGROUND_EVIDENCE;assert(output&&resolve(output)===output);await mkdir(output,{recursive:true,mode:0o700});
const fixture=await createOwnedManualFixture(process.argv.slice(2));let client;
try {
 const role='atlas_fixture_variant_collection',password=randomBytes(24).toString('hex');
 await fixture.cluster.sql(variantWorkerRoleSQL(role),[],fixture.database.name);
 await fixture.cluster.sql(`ALTER ROLE "${role}" LOGIN PASSWORD '${password}'`,[],fixture.database.name);
 await fixture.cluster.sql(variantWorkerGrantSQL(role),[],fixture.database.name);
 const url=new URL(fixture.database.adminUrl);url.username=role;url.password=password;url.searchParams.set('schema','atlas_manual');url.searchParams.set('connection_limit','1');
 client=new PrismaClient({datasources:{db:{url:url.href}},errorFormat:'minimal'});
 const forbidden=()=>assert.fail('accepted collection must not borrow human edit or dispatch authority');
 const repository=createAnalysisRepository({boundary:{transaction:forbidden},authorize:forbidden,assertCurrent:forbidden,receiptClient:client});
 const calls=[],preparedByResponse=new Map();
 const provider=createAstraDefectProvider({apiKey:'sk-owned_variant_background_fixture_only_123',fetchImpl:async(url,options)=>{
  assert.equal(options.method,'GET');calls.push({url,method:options.method});const prepared=preparedByResponse.get(url.split('/').at(-1));assert(prepared);
  const output=outputFixture(prepared.evidence);output.findings[0].localContour=[{x:40,y:40},{x:50,y:40},{x:50,y:52},{x:40,y:52}];
  return new Response(JSON.stringify({...responseFixture(prepared.evidence,output),id:url.split('/').at(-1)}),{status:200,headers:{'content-type':'application/json','x-request-id':'req_owned_variant_collection'}});
 }});
 const executor=createAnalysisExecutor({repository,provider,artifacts:fixture.artifacts});
 const other=createAnalysisExecutor({repository,provider:createAstraDefectProvider({apiKey:'sk-owned_main_background_fixture_only_123456',fetchImpl:forbidden}),artifacts:fixture.artifacts});
 const admission=createVariantAdmission({boundary:{machineTransaction:(_staff,work)=>client.$transaction(tx=>work({tx}))}});
 const owner=fixture.identities.find(x=>x.role==='REVIEWER'),checks=[];
 async function seed(expired=false) {
  const input=contextInputFixture();input.cardId=randomUUID();input.analysisId=randomUUID();const draft=canonical({source:{sourceHash:input.binding.sourceHash},identityRevision:input.binding.identityRevision});
  input.binding.manualRevision=1;input.binding.manualContentHash=digest(draft);
  const prepared=buildAstraContextBackgroundDefectRequest(input),responseId='resp_'+input.analysisId.replaceAll('-','');preparedByResponse.set(responseId,prepared);
  const ref=await storeAnalysisRequest(prepared,fixture.artifacts),requestEvidence={...prepared.evidence,providerBindingHash:provider.bindingHash},binding=canonical(prepared.evidence.binding),evidence=canonical(requestEvidence);
  const created=new Date(Date.now()-(expired?32*60000:1000)),received=new Date(created.getTime()+1000),pollUntil=new Date(received.getTime()+30*60000),createId=randomUUID();
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',input.cardId,randomUUID(),owner.id,createId,digest(createId),'Owned collection fixture');
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,owner_id,revision,content,content_hash) VALUES($1::uuid,$2::uuid,1,$3,$4)',input.cardId,owner.id,draft,digest(draft));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,created_at,expires_at)
   VALUES($1::uuid,$2::uuid,$1::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,'PREPARED',$11::timestamptz,$12::timestamptz)`,input.analysisId,input.cardId,owner.id,digest('fixture-base'),binding,digest(binding),prepared.requestHash,canonical(ref),evidence,digest(evidence),created,new Date(created.getTime()+180000));
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=created_at+interval '1 millisecond' WHERE id=$1::uuid",input.analysisId);
  await repository.appendAcceptance({analysisId:input.analysisId,requestHash:prepared.requestHash,providerBindingHash:provider.bindingHash,evidence:{responseId,providerRequestId:'req_owned_acceptance',httpStatus:200,providerStatus:'queued',model:'gpt-6-astra',responseHash:digest(responseId),receivedAt:received.toISOString(),pollUntil:pollUntil.toISOString()}});
  return {input,prepared,responseId};
 }
 async function preserved() {return (await fixture.admin.$queryRawUnsafe(`SELECT jsonb_build_object('intake',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM atlas_manual_intake.card t),'manual',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM atlas_manual.card t),'runs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM atlas_defect_analysis.run t),'acceptance',(SELECT jsonb_agg(to_jsonb(t) ORDER BY analysis_id,kind) FROM atlas_defect_analysis.provider_event t),'actions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY card_id,action_id) FROM atlas_manual.action t),'approvals',(SELECT jsonb_agg(to_jsonb(t) ORDER BY card_id,action_id) FROM atlas_manual.approval t)) value`))[0].value;}
 const current=await seed(),before=await preserved();assert.equal(await admission(),false);assert.equal((await other.pending()).items.length,0);assert.equal((await other.reconcile({analysisId:current.input.analysisId})).state,'SKIPPED');
 let resolveEvent;const settled=new Promise(resolve=>{resolveEvent=resolve;});
 const workers=createVariantWorkers({worker:{start(){},async stop(){}},reconciler:executor,onEvent:event=>{if(event.state==='SETTLED')resolveEvent(event);}});
 workers.start();try{await Promise.race([settled,new Promise((_resolve,reject)=>setTimeout(()=>reject(Error('COLLECTION_DID_NOT_SETTLE')),5000).unref())]);}finally{await workers.stop();}
 assert.equal(calls.length,1);assert.equal(await admission(),true);assert.deepEqual(await preserved(),before);
 const first=(await client.$queryRawUnsafe("SELECT evidence FROM atlas_defect_analysis.receipt WHERE analysis_id=$1::uuid AND kind='RESPONSE'",current.input.analysisId))[0];assert.equal(JSON.parse(first.evidence).state,'READY');
 checks.push('restricted variant collector finds its accepted binding while main binding cannot; collects under blocked admission; one synthetic GET reaches READY and releases priority without changing manual/source/run/acceptance/history');
 const expired=await seed(true),beforeExpired=await preserved();assert.equal(await admission(),false);assert.equal((await executor.reconcile({analysisId:expired.input.analysisId})).state,'UNKNOWN');assert.equal(calls.length,1);assert.equal(await admission(),false);
 const priorOutcome=await client.$queryRawUnsafe("SELECT * FROM atlas_defect_analysis.receipt WHERE analysis_id=$1::uuid AND kind='OUTCOME'",expired.input.analysisId);
 assert.equal((await executor.recoverAccepted({analysisId:expired.input.analysisId})).state,'SETTLED');assert.equal(calls.length,2);assert.equal(await admission(),true);assert.deepEqual(await preserved(),beforeExpired);
 assert.deepEqual(await client.$queryRawUnsafe("SELECT * FROM atlas_defect_analysis.receipt WHERE analysis_id=$1::uuid AND kind='OUTCOME'",expired.input.analysisId),priorOutcome);
 assert.equal((await executor.recoverAccepted({analysisId:expired.input.analysisId})).state,'SKIPPED');assert.equal(calls.length,2);
 checks.push('expired exact acceptance remains UNKNOWN under ordinary policy; explicit one-GET recovery appends terminal receipt, preserves outcome/deadline/history, releases priority and replays without another GET');
 for(const table of VARIANT_WORKER_FORBIDDEN_WRITES)assert.equal((await client.$queryRawUnsafe("SELECT has_table_privilege(current_user,$1,'INSERT') allowed",table))[0].allowed,false);
 assert.equal((await client.$queryRawUnsafe('SELECT rolconnlimit FROM pg_roles WHERE rolname=current_user'))[0].rolconnlimit,1);
 checks.push('existing one-connection restricted role suffices; all human/public/market INSERT grants remain forbidden');
 await writeFile(join(output,'result.json'),JSON.stringify({status:'PASS',checks,syntheticGets:calls.length,providerPosts:0,productionCalls:0,productionWrites:0},null,2),{mode:0o600});console.log(JSON.stringify({status:'PASS',groups:checks.length,syntheticGets:calls.length,providerPosts:0}));
}finally{await client?.$disconnect();await fixture.stop();}
