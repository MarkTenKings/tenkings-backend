import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createVariantReviewClient, variantApprovalReady, variantStatus } from '../lib/variant-review-client.mjs';
const hash = char => char.repeat(64);
export const catalogFixture = () => ({schemaVersion:'atlas-variant-catalog/v1',snapshotHash:hash('d'),candidates:[{candidateId:'exact',label:'Pikachu · Reverse holo',identity:{name:'Pikachu',setName:'151',cardNumber:'025/165',language:'English'},parallel:'Reverse holo',applicability:'supported',diagnostics:[{id:'foil',description:'Compare the foil pattern outside the artwork.'}],images:[]}]});
export const statusFixture = () => ({enabled:true,state:'READY',revision:9,sourceHash:hash('a'),identityRevision:1,identityHash:hash('b'),jobId:randomUUID(),resultHash:hash('c'),result:{catalog:catalogFixture(),suggestion:{candidateId:'exact',confidence:'high',reason:'Printed name and number match.'}},confirmation:null,approvalReady:false});
function fixture(){const values=new Map(),requests=[],cardId=randomUUID(),staffId=randomUUID();const f={status:statusFixture(),values,requests,storage:{getItem:key=>values.get(key)??null,setItem:(key,v)=>values.set(key,v),removeItem:key=>values.delete(key)}};
 f.options={cardId,staffId,storage:f.storage,request:async(path,options={})=>{requests.push({path,...structuredClone(options)});if(!options.method)return structuredClone(f.status);if(f.save)return f.save(options.body);const input=options.body;f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:input.decision!=='UNRESOLVED'};return structuredClone(f.status);}};
 f.client=createVariantReviewClient(f.options);return f;}
test('mount/read is read-only, suggestion does not approve, and local choice survives reload',async()=>{const f=fixture();const status=await f.client.read();assert.equal(variantApprovalReady(status),false);f.client.choose('exact');const next=createVariantReviewClient(f.options);await next.read();assert.equal(next.retained().draft.candidateId,'exact');assert.ok(f.requests.every(r=>!r.method));});
test('explicit selected confirmation binds current revision and clears only acknowledged action',async()=>{const f=fixture();await f.client.read();const result=await f.client.confirm({candidateId:'exact'});assert.equal(f.requests.filter(r=>r.method).length,1);const input=f.requests.at(-1).body;assert.equal(input.expectedRevision,9);assert.equal(input.reviewed,true);assert.equal(input.decision,'SELECTED');assert.equal(variantApprovalReady(result),true);assert.equal(f.client.retained(),null);});
test('lost save acknowledgement is reconciled by GET without duplicate POST',async()=>{const f=fixture();await f.client.read();f.save=input=>{f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:true};throw Error('lost acknowledgement');};await assert.rejects(f.client.confirm({candidateId:'exact'}));assert.ok(f.client.retained().pending);const fresh=createVariantReviewClient(f.options);await fresh.read();assert.equal(fresh.retained(),null);assert.equal(f.requests.filter(r=>r.method).length,1);});
test('unconfirmed save retries exact action and payload after fresh read',async()=>{const f=fixture();await f.client.read();f.save=()=>{throw Error('network');};await assert.rejects(f.client.confirm({candidateId:'exact'}));const first=f.requests.at(-1).body;f.save=null;await createVariantReviewClient(f.options).resume();assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[first,first]);});
test('new source between selection and confirmation prevents write',async()=>{const f=fixture();await f.client.read();f.status.sourceHash=hash('f');await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_REVIEW_CHANGED'});assert.equal(f.requests.filter(r=>r.method).length,0);});
test('definitive stale refusal permits re-review, unknown rejection keeps exact pending',async()=>{const f=fixture();await f.client.read();f.save=()=>{throw {status:409,code:'VARIANT_RESULT_STALE'};};await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_REVIEW_CHANGED'});assert.equal(f.client.retained(),null);f.save=()=>{throw {status:403,code:'SESSION_EXPIRED'};};await assert.rejects(f.client.confirm({candidateId:'exact'}));assert.ok(f.client.retained().pending);});
test('storage failure stops POST; UNRESOLVED saves a hold without approval',async()=>{const f=fixture();await f.client.read();f.storage.setItem=()=>{throw Error('quota');};await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_LOCAL_UNAVAILABLE'});assert.equal(f.requests.filter(r=>r.method).length,0);const g=fixture();await g.client.read();const result=await g.client.confirm({unresolved:true,candidateId:null});assert.equal(result.confirmation.decision,'UNRESOLVED');assert.equal(variantApprovalReady(result),false);});
test('an unresolved hold does not require a completed catalog result in any preparation state',async()=>{
 for(const state of ['NOT_REQUESTED','QUEUED','SEARCHING','UNKNOWN','FAILED','STALE','READY']){
  const f=fixture();f.status={...f.status,state,jobId:state==='NOT_REQUESTED'?null:hash('e'),resultHash:null,result:null};await f.client.read();
  const result=await f.client.confirm({candidateId:null,unresolved:true}),input=f.requests.at(-1).body;
  assert.equal(input.jobId,null,state);assert.equal(input.resultHash,null,state);assert.equal(input.decision,'UNRESOLVED');
  assert.equal(result.confirmation.sourceHash,f.status.sourceHash);assert.equal(variantApprovalReady(result),false);assert.equal(f.client.retained(),null);
 }
});
test('manual physical observations are explicit, do not claim a catalog candidate, and can satisfy saved gate',async()=>{const f=fixture();await f.client.read();const result=await f.client.confirm({candidateId:null,manual:{parallel:' English, reverse holo ',features:' Foil outside picture, English text and 025/165. '}});const input=f.requests.at(-1).body;assert.equal(input.decision,'MANUAL');assert.equal(input.jobId,null);assert.equal(input.resultHash,null);assert.equal(input.manualParallel,'English, reverse holo');assert.equal(variantApprovalReady(result),true);});
test('gate rejects obsolete confirmation even if approvalReady is true',()=>{const s=statusFixture();s.approvalReady=true;s.confirmation={decision:'SELECTED',selectedCandidateId:'exact',sourceHash:s.sourceHash,identityRevision:0,identityHash:s.identityHash};assert.equal(variantApprovalReady(s),false);assert.throws(()=>variantStatus({...s,result:{catalog:{candidates:[]}}}),{code:'VARIANT_RESPONSE_INVALID'});});


test('known unresolved printing refusal clears only that rejected intent so manual observations remain available',async()=>{const f=fixture();await f.client.read();f.save=()=>{throw {status:409,code:'VARIANT_FINISH_UNRESOLVED'};};await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_FINISH_UNRESOLVED'});assert.equal(f.client.retained(),null);f.client.choose(null,null,{parallel:'English reverse holo',features:'Visible foil outside picture.'});assert.equal(f.client.retained().draft.manual.parallel,'English reverse holo');});
test('definite stale recheck fence clears the rejected intent for an explicit fresh review',async()=>{const f=fixture();await f.client.read();f.save=()=>{throw {status:409,code:'VARIANT_RECHECK_STALE'};};await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_REVIEW_CHANGED'});assert.equal(f.client.retained(),null);assert.equal(f.requests.filter(r=>r.method).length,1);});

test('explicit library refresh retains request identity and reconciles a lost reply without redispatch',async()=>{const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await f.client.read();f.save=input=>{f.status={...f.status,state:'QUEUED',refreshable:false,jobId:hash('f'),refreshRequestId:input.requestId,result:null};throw Error('lost refresh acknowledgement');};await assert.rejects(f.client.refresh());const input=f.requests.at(-1).body;assert.equal(f.requests.at(-1).path.endsWith('/refresh'),true);assert.equal(f.client.retained().operation,'REFRESH');assert.equal(input.jobId,hash('e'));await createVariantReviewClient(f.options).resume();assert.equal(f.requests.filter(r=>r.method).length,1);assert.equal(f.client.retained(),null);});
test('unacknowledged library request resumes exact payload and clears a known refusal only',async()=>{const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await f.client.read();f.save=()=>{throw {status:503};};await assert.rejects(f.client.refresh());const first=f.requests.at(-1).body;f.save=input=>({...f.status,state:'QUEUED',refreshable:false,refreshRequestId:input.requestId});await f.client.resume();assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[first,first]);const g=fixture();g.status.jobId=hash('e');g.status.refreshable=true;await g.client.read();g.save=()=>{throw {status:409,code:'VARIANT_REFRESH_CONFLICT'};};await assert.rejects(g.client.refresh(),{code:'VARIANT_REFRESH_UNAVAILABLE'});assert.equal(g.client.retained(),null);});
test('pending, unknown, or not-requested library preparation cannot be refreshed by inference',async()=>{for(const state of ['QUEUED','SEARCHING','UNKNOWN','NOT_REQUESTED']){const f=fixture();f.status={...f.status,state,refreshable:false};await f.client.read();await assert.rejects(f.client.refresh(),{code:'VARIANT_REFRESH_UNAVAILABLE'});assert.equal(f.requests.filter(r=>r.method).length,0);}});

test('exact replay acknowledges a superseded save independently of the newer current confirmation or reference job',async()=>{
 for(const operation of ['CONFIRM','REFRESH']){
  const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await f.client.read();f.save=()=>{throw Error('lost reply');};
  await assert.rejects(operation==='CONFIRM'?f.client.confirm({candidateId:'exact'}):f.client.refresh());const original=f.requests.at(-1).body;
  f.status={...f.status,revision:12,identityRevision:2,identityHash:hash('f'),jobId:hash('a'),refreshRequestId:randomUUID(),confirmation:null};
  f.save=input=>({...f.status,acknowledgedRequest:{operation,requestId:input.actionId??input.requestId,sourceHash:input.sourceHash,identityRevision:input.identityRevision,identityHash:input.identityHash}});
  const result=await createVariantReviewClient(f.options).resume();assert.equal(result.identityRevision,2);assert.equal(f.client.retained(),null);
  assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[original,original]);
 }
});

test('a historical acknowledgement must match every original binding and is accepted only on exact POST replay',async()=>{
 for(const field of ['operation','requestId','sourceHash','identityRevision','identityHash']){
  const f=fixture();await f.client.read();f.save=()=>{throw Error('lost reply');};await assert.rejects(f.client.confirm({candidateId:'exact'}));
  const pending=f.client.retained().pending,receipt={operation:'CONFIRM',requestId:pending.actionId,sourceHash:pending.sourceHash,identityRevision:pending.identityRevision,identityHash:pending.identityHash};
  f.status={...f.status,revision:12,identityRevision:2,identityHash:hash('f'),confirmation:null,acknowledgedRequest:receipt};
  await f.client.read();assert.ok(f.client.retained()?.pending,'a GET envelope cannot acknowledge a historical operation');
  f.save=()=>({...f.status,acknowledgedRequest:{...receipt,[field]:field==='identityRevision'?99:'unrelated'}});
  await assert.rejects(f.client.resume(),{code:'VARIANT_SAVE_UNCONFIRMED'});assert.equal(f.client.retained().pending.actionId,pending.actionId,field);
 }
});

const photoPermission={basis:'owned_original',detail:'I took these photos and authorize internal reference review.',consumers:['inventory','atlas']};
test('optional photo permission is absent by default and explicitly retained with the bound draft and confirmation',async()=>{
 const ordinary=fixture();await ordinary.client.read();await ordinary.client.confirm({candidateId:'exact'});assert.equal(Object.hasOwn(ordinary.requests.at(-1).body,'referencePermission'),false);
 const f=fixture();await f.client.read();f.client.choose('exact',null,null,photoPermission);const reopened=createVariantReviewClient(f.options);await reopened.read();
 assert.deepEqual(reopened.retained().draft.referencePermission,photoPermission);await reopened.confirm({candidateId:'exact',referencePermission:{...photoPermission,detail:` ${photoPermission.detail} `}});
 assert.deepEqual(f.requests.at(-1).body.referencePermission,photoPermission);assert.equal(f.client.retained(),null);
});
test('incomplete or broadened photo rights never submit and an unresolved hold omits even supplied permission',async()=>{
 for(const permission of [{...photoPermission,basis:''},{...photoPermission,detail:' '},{...photoPermission,detail:'x'.repeat(1001)},{...photoPermission,consumers:['atlas','public']}]){
  const f=fixture();await f.client.read();await assert.rejects(f.client.confirm({candidateId:'exact',referencePermission:permission}),{code:'VARIANT_REFERENCE_PERMISSION_INVALID'});assert.equal(f.requests.filter(r=>r.method).length,0);
 }
 const f=fixture();await f.client.read();f.client.choose(null,'CANNOT_TELL',null,photoPermission);assert.equal(Object.hasOwn(f.client.retained().draft,'referencePermission'),false);
 await f.client.confirm({candidateId:null,unresolved:true,referencePermission:photoPermission});assert.equal(Object.hasOwn(f.requests.at(-1).body,'referencePermission'),false);assert.equal(f.requests.at(-1).body.decision,'UNRESOLVED');
});
test('denied access retains exact opted-in permission through reload and replay; definite invalid permission clears only its rejected action',async()=>{
 const f=fixture();await f.client.read();f.save=()=>{throw {status:403,code:'SESSION_EXPIRED'};};await assert.rejects(f.client.confirm({candidateId:'exact',referencePermission:photoPermission}));
 const original=f.requests.at(-1).body;assert.deepEqual(f.client.retained().pending.referencePermission,photoPermission);f.save=null;await createVariantReviewClient(f.options).resume();
 assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[original,original]);
 const g=fixture();await g.client.read();g.save=()=>{throw {status:400,code:'VARIANT_REFERENCE_PERMISSION_INVALID'};};await assert.rejects(g.client.confirm({candidateId:'exact',referencePermission:photoPermission}),{code:'VARIANT_REFERENCE_PERMISSION_INVALID'});assert.equal(g.client.retained(),null);
});
test('a changed source or identity cannot reuse a prepared photo-permission confirmation',async()=>{
 for(const field of ['sourceHash','identityHash','identityRevision']){const f=fixture();await f.client.read();f.client.choose('exact',null,null,photoPermission);f.status[field]=field==='identityRevision'?2:hash('f');
 await assert.rejects(f.client.confirm({candidateId:'exact',referencePermission:photoPermission}),{code:'VARIANT_REVIEW_CHANGED'});assert.equal(f.requests.filter(r=>r.method).length,0);}
});
