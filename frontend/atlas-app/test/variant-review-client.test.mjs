import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createVariantReviewClient, variantApprovalReady, variantStatus } from '../lib/variant-review-client.mjs';
const hash = char => char.repeat(64);
export const catalogFixture = () => ({schemaVersion:'atlas-variant-catalog/v1',snapshotHash:hash('d'),candidates:[{candidateId:'exact',label:'Pikachu · Reverse holo',identity:{name:'Pikachu',setName:'151',cardNumber:'025/165',language:'English'},parallel:'Reverse holo',applicability:'supported',diagnostics:[{id:'foil',description:'Compare the foil pattern outside the artwork.'}],images:[]}]});
export const statusFixture = () => ({enabled:true,state:'READY',revision:9,sourceHash:hash('a'),identityRevision:1,identityHash:hash('b'),jobId:randomUUID(),resultHash:hash('c'),result:{catalog:catalogFixture(),suggestion:{candidateId:'exact',confidence:'high',reason:'Printed name and number match.'}},confirmation:null,approvalReady:false});
function fixture(){const values=new Map(),requests=[],cardId=randomUUID(),staffId=randomUUID();const f={status:statusFixture(),values,requests,storage:{getItem:key=>values.get(key)??null,setItem:(key,v)=>values.set(key,v),removeItem:key=>values.delete(key)}};
 f.options={cardId,staffId,storage:f.storage,request:async(path,options={})=>{requests.push({path,...structuredClone(options)});if(!options.method)return structuredClone(f.status);if(f.save)return f.save(options.body);const input=options.body;f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:true};return structuredClone(f.status);}};
 f.client=createVariantReviewClient(f.options);return f;}
test('mount/read is read-only, suggestion does not approve, and local choice survives reload',async()=>{const f=fixture();const status=await f.client.read();assert.equal(variantApprovalReady(status),false);f.client.choose('exact');const next=createVariantReviewClient(f.options);await next.read();assert.equal(next.retained().draft.candidateId,'exact');assert.ok(f.requests.every(r=>!r.method));});
test('explicit selected confirmation binds current revision and clears only acknowledged action',async()=>{const f=fixture();await f.client.read();const result=await f.client.confirm({candidateId:'exact'});assert.equal(f.requests.filter(r=>r.method).length,1);const input=f.requests.at(-1).body;assert.equal(input.expectedRevision,9);assert.equal(input.reviewed,true);assert.equal(input.decision,'SELECTED');assert.equal(variantApprovalReady(result),true);assert.equal(f.client.retained(),null);});
test('lost save acknowledgement is reconciled by GET without duplicate POST',async()=>{const f=fixture();await f.client.read();f.save=input=>{f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:true};throw Error('lost acknowledgement');};await assert.rejects(f.client.confirm({candidateId:'exact'}));assert.ok(f.client.retained().pending);const fresh=createVariantReviewClient(f.options);await fresh.read();assert.equal(fresh.retained(),null);assert.equal(f.requests.filter(r=>r.method).length,1);});
test('unconfirmed save retries exact action and payload after fresh read',async()=>{const f=fixture();await f.client.read();f.save=()=>{throw Error('network');};await assert.rejects(f.client.confirm({candidateId:'exact'}));const first=f.requests.at(-1).body;f.save=null;await createVariantReviewClient(f.options).resume();assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[first,first]);});
test('new source between selection and confirmation prevents write',async()=>{const f=fixture();await f.client.read();f.status.sourceHash=hash('f');await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_REVIEW_CHANGED'});assert.equal(f.requests.filter(r=>r.method).length,0);});
test('definitive stale refusal permits re-review, unknown rejection keeps exact pending',async()=>{const f=fixture();await f.client.read();f.save=()=>{throw {status:409,code:'VARIANT_RESULT_STALE'};};await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_REVIEW_CHANGED'});assert.equal(f.client.retained(),null);f.save=()=>{throw {status:403,code:'SESSION_EXPIRED'};};await assert.rejects(f.client.confirm({candidateId:'exact'}));assert.ok(f.client.retained().pending);});
test('storage failure stops POST; UNRESOLVED saves an explicit decision without fabricating a variant',async()=>{const f=fixture();await f.client.read();f.storage.setItem=()=>{throw Error('quota');};await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_LOCAL_UNAVAILABLE'});assert.equal(f.requests.filter(r=>r.method).length,0);const g=fixture();await g.client.read();const result=await g.client.confirm({unresolved:true,candidateId:null});assert.equal(result.confirmation.decision,'UNRESOLVED');assert.equal(variantApprovalReady(result),true);assert.equal(f.requests.some(r=>r.path.endsWith('/approve')),false);});
test('an unresolved hold does not require a completed catalog result in any preparation state',async()=>{
 for(const state of ['NOT_REQUESTED','QUEUED','SEARCHING','UNKNOWN','FAILED','STALE','READY']){
  const f=fixture();f.status={...f.status,state,jobId:state==='NOT_REQUESTED'?null:hash('e'),resultHash:null,result:null};await f.client.read();
  const result=await f.client.confirm({candidateId:null,unresolved:true}),input=f.requests.at(-1).body;
  assert.equal(input.jobId,null,state);assert.equal(input.resultHash,null,state);assert.equal(input.decision,'UNRESOLVED');
  assert.equal(result.confirmation.sourceHash,f.status.sourceHash);assert.equal(variantApprovalReady(result),true);assert.equal(f.client.retained(),null);
 }
});
test('manual physical observations are explicit, do not claim a catalog candidate, and can satisfy saved gate',async()=>{const f=fixture();await f.client.read();const result=await f.client.confirm({candidateId:null,manual:{parallel:' English, reverse holo '}});const input=f.requests.at(-1).body;assert.equal(input.decision,'MANUAL');assert.equal(input.jobId,null);assert.equal(input.resultHash,null);assert.equal(input.manualParallel,'English, reverse holo');assert.equal(variantApprovalReady(result),true);});
test('gate rejects obsolete confirmation even if approvalReady is true',()=>{const s=statusFixture();s.approvalReady=true;s.confirmation={decision:'SELECTED',selectedCandidateId:'exact',sourceHash:s.sourceHash,identityRevision:0,identityHash:s.identityHash};assert.equal(variantApprovalReady(s),false);assert.throws(()=>variantStatus({...s,result:{catalog:{candidates:[]}}}),{code:'VARIANT_RESPONSE_INVALID'});});


test('known unresolved printing refusal clears only that rejected intent so manual observations remain available',async()=>{const f=fixture();await f.client.read();f.save=()=>{throw {status:409,code:'VARIANT_FINISH_UNRESOLVED'};};await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_FINISH_UNRESOLVED'});assert.equal(f.client.retained(),null);f.client.choose(null,null,{parallel:'English reverse holo'});assert.equal(f.client.retained().draft.manual.parallel,'English reverse holo');});


test('explicit library refresh retains request identity and reconciles a lost reply without redispatch',async()=>{const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await f.client.read();f.save=input=>{f.status={...f.status,state:'QUEUED',refreshable:false,jobId:hash('f'),refreshRequestId:input.requestId,result:null};throw Error('lost refresh acknowledgement');};await assert.rejects(f.client.refresh());const input=f.requests.at(-1).body;assert.equal(f.requests.at(-1).path.endsWith('/refresh'),true);assert.equal(f.client.retained().operation,'REFRESH');assert.equal(input.jobId,hash('e'));await createVariantReviewClient(f.options).resume();assert.equal(f.requests.filter(r=>r.method).length,1);assert.equal(f.client.retained(),null);});
test('unacknowledged library request resumes exact payload and clears a known refusal only',async()=>{const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await f.client.read();f.save=()=>{throw {status:503};};await assert.rejects(f.client.refresh());const first=f.requests.at(-1).body;f.save=input=>({...f.status,state:'QUEUED',refreshable:false,refreshRequestId:input.requestId});await f.client.resume();assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[first,first]);const g=fixture();g.status.jobId=hash('e');g.status.refreshable=true;await g.client.read();g.save=()=>{throw {status:409,code:'VARIANT_REFRESH_CONFLICT'};};await assert.rejects(g.client.refresh(),{code:'VARIANT_REFRESH_UNAVAILABLE'});assert.equal(g.client.retained(),null);});
test('pending, unknown, or not-requested library preparation cannot be refreshed by inference',async()=>{for(const state of ['QUEUED','SEARCHING','UNKNOWN','NOT_REQUESTED']){const f=fixture();f.status={...f.status,state,refreshable:false};await f.client.read();await assert.rejects(f.client.refresh(),{code:'VARIANT_REFRESH_UNAVAILABLE'});assert.equal(f.requests.filter(r=>r.method).length,0);}});

test('explicit first reference preparation preserves a current physical confirmation and reconciles a lost reply',async()=>{
 const f=fixture();f.status={...f.status,state:'NOT_REQUESTED',jobId:null,result:null,resultHash:null,refreshable:true,approvalReady:true};
 const confirmation={decision:'MANUAL',sourceHash:f.status.sourceHash,identityRevision:1,identityHash:f.status.identityHash};f.status.confirmation=confirmation;
 await f.client.read();assert.equal(f.requests.filter(r=>r.method).length,0);
 f.save=input=>{f.status={...f.status,state:'QUEUED',jobId:hash('e'),refreshable:false,refreshRequestId:input.requestId};throw Error('lost initial request reply');};
 await assert.rejects(f.client.refresh());assert.equal(f.requests.at(-1).body.jobId,null);
 const reopened=createVariantReviewClient(f.options),result=await reopened.resume();
 assert.equal(f.requests.filter(r=>r.method).length,1);assert.equal(reopened.retained(),null);
 assert.deepEqual(result.confirmation,confirmation);assert.equal(variantApprovalReady(result),true);
});

test('an absent job only permits initial preparation in an explicitly refreshable not-requested state',async()=>{
 for(const state of ['READY','FAILED','STALE','QUEUED','SEARCHING','UNKNOWN']){
  const f=fixture();f.status={...f.status,state,jobId:null,refreshable:true};await f.client.read();
  await assert.rejects(f.client.refresh(),{code:'VARIANT_REFRESH_UNAVAILABLE'});assert.equal(f.requests.filter(r=>r.method).length,0);
 }
});

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

test('new confirmation requests never forward retired catalog photo permissions',async()=>{
 const f=fixture();await f.client.read();await f.client.confirm({candidateId:'exact',referencePermission:{basis:'owned_original',consumers:['inventory','atlas']}});
 assert.equal(Object.hasOwn(f.requests.at(-1).body,'referencePermission'),false);
});

test('a physical Base or named printing choice survives background reference changes in every state',async()=>{
 for(const state of ['NOT_REQUESTED','QUEUED','SEARCHING','FAILED','UNKNOWN','READY']){
  const f=fixture();f.status.state=state;await f.client.read();f.client.choose(null,null,{parallel:'Base'});
  f.status={...f.status,jobId:hash('f'),resultHash:hash('e'),result:null,state:'SEARCHING'};
  const result=await f.client.confirm({candidateId:null,manual:{parallel:'Base'}});
  assert.equal(variantApprovalReady(result),true,state);assert.equal(f.requests.at(-1).body.manualParallel,'Base');
  assert.equal(Object.hasOwn(f.requests.at(-1).body,'observedFeatures'),false);
 }
});
test('same catalog choice survives regenerated references; reused candidate ID cannot silently change identity',async()=>{
 for(const changed of [false,true]){const f=fixture();await f.client.read();f.client.choose('exact');
  f.status.jobId=hash('e');f.status.resultHash=hash('f');f.status.result.catalog.snapshotHash=hash('e');
  if(changed)f.status.result.catalog.candidates[0].identity.name='Raichu';
  if(changed)await assert.rejects(f.client.confirm({candidateId:'exact'}),{code:'VARIANT_CANDIDATE_STALE'});
  else assert.equal(variantApprovalReady(await f.client.confirm({candidateId:'exact'})),true);
  assert.equal(f.requests.filter(r=>r.method).length,changed?0:1);
 }
});
test('manual confirmation never defaults an empty printing to Base',async()=>{
 const f=fixture();await f.client.read();await assert.rejects(f.client.confirm({candidateId:null,manual:{parallel:''}}),{code:'VARIANT_MANUAL_INVALID'});
 assert.equal(f.requests.filter(r=>r.method).length,0);
});
test('a definitively refused old request releases its pending lock without rewriting or reusing its action ID',async()=>{
 for(const code of ['MANUAL_REQUEST_INVALID','VARIANT_CONFIRMATION_INVALID']){
  const f=fixture();await f.client.read();f.save=()=>{throw Error('lost reply');};
  await assert.rejects(f.client.confirm({candidateId:null,manual:{parallel:'Base'}}));
  const [key,value]=[...f.values][0],saved=JSON.parse(value);saved.pending.referencePermission={basis:'owned_original',consumers:['inventory','atlas']};f.values.set(key,JSON.stringify(saved));
  f.save=()=>{throw {status:400,code};};const reopened=createVariantReviewClient(f.options);
  await assert.rejects(reopened.resume(),{code:'VARIANT_REQUEST_RETIRED'});
  assert.deepEqual(f.requests.at(-1).body,saved.pending,'exact old request is reconciled, never transformed');
  assert.equal(reopened.retained(),null);
  reopened.choose(null,null,{parallel:'Base'});f.save=null;await reopened.confirm({candidateId:null,manual:{parallel:'Base'}});
  assert.notEqual(f.requests.at(-1).body.actionId,saved.pending.actionId);
  assert.equal(Object.hasOwn(f.requests.at(-1).body,'observedFeatures'),false);
 }
});
test('a saved old request is acknowledged before any replay, while an unknown 400 remains recoverable',async()=>{
 const f=fixture();await f.client.read();f.save=()=>{throw Error('lost reply');};await assert.rejects(f.client.confirm({candidateId:'exact'}));
 const saved=f.client.retained().pending;f.status.confirmation={...saved,selectedCandidateId:saved.candidateId};
 await createVariantReviewClient(f.options).resume();assert.equal(f.client.retained(),null);assert.equal(f.requests.filter(r=>r.method).length,1);
 const g=fixture();await g.client.read();g.save=()=>{throw {status:400,code:'UNKNOWN'};};await assert.rejects(g.client.confirm({candidateId:'exact'}));assert.ok(g.client.retained()?.pending);
});

function creditFailure(f){Object.assign(f.status,{state:'FAILED',jobId:hash('e'),catalogManifestHash:hash('d'),refreshable:false,labelRetryRequestId:null,
 labelFailure:{code:'VARIANT_OPENAI_CREDITS_EXHAUSTED',retryable:true,labelRequestKey:`variant-label-source:v1:${hash('f')}`,labelResponseHash:hash('a')}});return f;}
const acceptLabelRetry=(f,input)=>({...f.status,state:'QUEUED',labelRetryRequestId:input.requestId,labelFailure:{...f.status.labelFailure,retryable:false}});
test('label retry uses the exact retained failure and catalog, preserves a physical draft and never confirms or refreshes',async()=>{
 const f=creditFailure(fixture());await f.client.read();f.client.choose(null,null,{parallel:'Base'});const draft=f.client.retained().draft;
 assert.equal(f.requests.filter(r=>r.method).length,0);f.save=input=>acceptLabelRetry(f,input);
 const result=await f.client.retryLabels(),post=f.requests.at(-1);
 assert.equal(post.path,`/api/staff/manual-connected/cards/${f.options.cardId}/variants/retry-labels`);
 assert.deepEqual(Object.keys(post.body).sort(),['requestId','sourceHash','identityRevision','identityHash','jobId','catalogManifestHash','labelRequestKey','labelResponseHash'].sort());
 assert.equal(post.body.jobId,f.status.jobId);assert.equal(post.body.catalogManifestHash,f.status.catalogManifestHash);
 assert.equal(post.body.labelRequestKey,f.status.labelFailure.labelRequestKey);assert.equal(post.body.labelResponseHash,f.status.labelFailure.labelResponseHash);
 assert.equal(result.confirmation,null);assert.equal(variantApprovalReady(result),false);assert.deepEqual(result.result,f.status.result);
 assert.deepEqual(f.client.retained().draft,draft);assert.equal(f.client.retained().pending,undefined);
});
test('lost label retry acknowledgement reconciles by read across reload without another POST or loss of local choice',async()=>{
 const f=creditFailure(fixture());await f.client.read();f.client.choose('exact');const draft=f.client.retained().draft;
 f.save=input=>{f.status=acceptLabelRetry(f,input);throw Error('lost reply');};await assert.rejects(f.client.retryLabels());
 assert.equal(f.client.retained().operation,'RETRY_LABELS');const id=f.client.retained().pending.requestId;
 const reopened=createVariantReviewClient(f.options);await reopened.resume();assert.equal(f.status.labelRetryRequestId,id);
 assert.equal(f.requests.filter(r=>r.method).length,1);assert.deepEqual(reopened.retained().draft,draft);assert.equal(reopened.retained().pending,undefined);
});
test('uncertain label retry replays the exact journal while definite refusal releases only that request',async()=>{
 for(const rejection of [null,'VARIANT_LABEL_RETRY_INVALID','VARIANT_LABEL_RETRY_UNAVAILABLE','VARIANT_LABEL_RETRY_CONFLICT']){
  const f=creditFailure(fixture());await f.client.read();f.client.choose(null,null,{parallel:'Base'});const draft=f.client.retained().draft;
  f.save=()=>{throw {status:503};};await assert.rejects(f.client.retryLabels());const original=f.requests.at(-1).body;
  f.save=input=>{if(rejection)throw {status:rejection.endsWith('INVALID')?400:409,code:rejection};return acceptLabelRetry(f,input);};
  const reopened=createVariantReviewClient(f.options);
  if(rejection)await assert.rejects(reopened.resume(),{code:'VARIANT_LABEL_RETRY_UNAVAILABLE'});else await reopened.resume();
  assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[original,original]);assert.deepEqual(reopened.retained().draft,draft);assert.equal(reopened.retained().pending,undefined);
 }
});
test('changed label failure or catalog binding refuses retry before dispatch',async()=>{
 for(const change of [s=>s.sourceHash=hash('c'),s=>s.identityRevision++,s=>s.identityHash=hash('c'),s=>s.jobId=hash('c'),s=>s.catalogManifestHash=hash('c'),s=>s.labelFailure.labelRequestKey='another-source',s=>s.labelFailure.labelResponseHash=hash('c')]){
  const f=creditFailure(fixture());await f.client.read();change(f.status);await assert.rejects(f.client.retryLabels(),{code:'VARIANT_REVIEW_CHANGED'});assert.equal(f.requests.filter(r=>r.method).length,0);
 }
});
test('only a definite retryable failed label state allows explicit retry and general refresh cannot bypass it',async()=>{
 for(const state of ['QUEUED','SEARCHING','READY','UNKNOWN','STALE','NOT_REQUESTED']){
  const f=creditFailure(fixture());f.status.state=state;await f.client.read();await assert.rejects(f.client.retryLabels(),{code:'VARIANT_LABEL_RETRY_UNAVAILABLE'});assert.equal(f.requests.filter(r=>r.method).length,0);
 }
 const f=creditFailure(fixture());f.status.labelFailure.retryable=false;f.status.refreshable=true;await f.client.read();
 await assert.rejects(f.client.retryLabels(),{code:'VARIANT_LABEL_RETRY_UNAVAILABLE'});await assert.rejects(f.client.refresh(),{code:'VARIANT_REFRESH_UNAVAILABLE'});assert.equal(f.requests.filter(r=>r.method).length,0);
});
test('label failure status refuses malformed retry proof without displaying an actionable retry',()=>{
 for(const change of [s=>s.labelFailure.code='UNKNOWN',s=>s.labelFailure.retryable='true',s=>s.labelFailure.labelRequestKey='',s=>s.labelFailure.labelResponseHash='bad',s=>s.catalogManifestHash=null,s=>s.jobId=null,s=>s.labelRetryRequestId='bad']){
  const f=creditFailure(fixture());change(f.status);assert.throws(()=>variantStatus(f.status),{code:'VARIANT_RESPONSE_INVALID'});
 }
});
test('historical label retry receipt must match the original intent before releasing it after identity changes',async()=>{
 const f=creditFailure(fixture());await f.client.read();f.save=()=>{throw Error('lost reply');};await assert.rejects(f.client.retryLabels());const original=f.requests.at(-1).body;
 f.status={...f.status,identityRevision:2,identityHash:hash('f'),jobId:hash('b'),catalogManifestHash:hash('c')};
 f.save=input=>({...f.status,acknowledgedRequest:{operation:'RETRY_LABELS',requestId:input.requestId,sourceHash:input.sourceHash,identityRevision:input.identityRevision,identityHash:input.identityHash}});
 const reopened=createVariantReviewClient(f.options);await reopened.resume();assert.equal(reopened.retained(),null);assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[original,original]);
});
test('definitive stale label retry refusal releases the exact request and preserves the physical draft',async()=>{
 for(const code of ['VARIANT_SOURCE_STALE','VARIANT_IDENTITY_STALE','VARIANT_RESULT_STALE','MANUAL_DRAFT_STALE']){
  const f=creditFailure(fixture());await f.client.read();f.client.choose(null,null,{parallel:'Base'});const draft=f.client.retained().draft;
  f.save=()=>{throw {status:409,code};};await assert.rejects(f.client.retryLabels(),{code:'VARIANT_REVIEW_CHANGED'});
  assert.equal(f.client.retained().pending,undefined);assert.deepEqual(f.client.retained().draft,draft);assert.equal(f.requests.filter(r=>r.method).length,1);
 }
});
test('a retained general refresh refused for exhausted credits clears without starting another acquisition',async()=>{
 const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await f.client.read();f.save=()=>{throw Error('lost reply');};await assert.rejects(f.client.refresh());
 const original=f.requests.at(-1).body;creditFailure(f);f.save=()=>{throw {status:409,code:'VARIANT_LABEL_RETRY_REQUIRED'};};
 const reopened=createVariantReviewClient(f.options);await assert.rejects(reopened.resume(),{code:'VARIANT_LABEL_RETRY_REQUIRED'});assert.equal(reopened.retained(),null);
 assert.deepEqual(f.requests.filter(r=>r.method).map(r=>r.body),[original,original]);
});
