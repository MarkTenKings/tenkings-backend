import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {hash} from '../src/contract.mjs';
import {assertProofDecoderTargetBrokerClient,assertProofDecoderPreparedSubmission,assertProofDecoderClientOutcome} from '../src/proof-decoder-target-broker.mjs';
import {openProofPublicationDispatchStore,migrateProofPublicationLedgerV3} from '../src/proof-publication-store.mjs';
import {PUBLICATION_DISPATCH_SQL,PUBLICATION_LIFECYCLE_LIMITS as L,publicationCapacity,publicationDecoderIdentity,publicationDecoderDispatch,publicationDecoderSettlement,publicationDecoderOutcome,publicationDispatchMigration,publicationHold} from '../src/proof-publication-lifecycle.mjs';

// Data-only fixtures. No client, observer or outcome brand is faked.
function identity(){
  const binding={installationId:randomUUID(),qualificationSessionId:randomUUID(),qualificationEvidenceHash:hash('fixture'),sourceClosureHash:hash('closure'),policyHash:hash('policy'),intakeBindingHash:hash('intake')},bootId=randomUUID(),deadlineBootNs='10000000000';
  const prepared={schema:'atlas-proof-decoder-prepared-request-v1',classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false,requestId:randomUUID(),deadlineBootNs,plan:{declaredType:'image/png',byteCount:12,sha256:hash('original')},bootId,epoch:'FIXTURE',bindingHash:hash('broker'),profileHash:hash('profile'),limitsHash:hash('limits')};
  return {schema:'atlas-proof-publication-decoder-identity-v1',ledgerId:randomUUID(),sessionId:randomUUID(),binding,prepared,stageBinding:{...binding,stageId:randomUUID(),stageRevision:2,requestId:randomUUID(),requestBindingHash:hash('request'),actorAccessBindingHash:hash('actor'),operationHash:hash('operation'),bootId,deadlineBootNs,fences:[{fenceId:randomUUID(),sourceKind:'POLICY',sourceKeyHash:hash('key'),sourceGenerationHash:hash('generation'),ordinal:1,revision:1}]}};
}
const outcome=(i,disposition='KNOWN_NO_START_SENT')=>({schema:'atlas-proof-decoder-client-disposition-v1',classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false,disposition,request:i.prepared,completion:null});

test('v3 entrypoints are default-off and refuse authority, storage, clock and recovery injection',()=>{
  for(const open of [openProofPublicationDispatchStore,migrateProofPublicationLedgerV3]){assert.equal(open(),null);for(const key of ['authorize','qualified','store','clock','release','fault'])assert.throws(()=>open({enabled:false,[key]:()=>true}));let touched=false;assert.throws(()=>open({get enabled(){touched=true;return true;}}));assert.equal(touched,false);}
  assert.throws(()=>openProofPublicationDispatchStore({enabled:true,linuxObserver:{boottimeNanoseconds:()=>1n}}),{code:'DECODER_LINUX_OBSERVER_REQUIRED'});
});
test('direct producer verifiers cannot be satisfied by supplied methods, JSON, wrappers or getters',()=>{
  let called=0;const client={lookupDisposition(){called++;return outcome(identity());},prepareRequest(){called++;}};
  for(const value of [null,{},client,Object.freeze({classification:'UNQUALIFIED'})]){assert.throws(()=>assertProofDecoderTargetBrokerClient(value),{code:'DECODER_BROKER_CLIENT_REQUIRED'});assert.throws(()=>assertProofDecoderPreparedSubmission({report:identity().prepared},{client:value}));assert.throws(()=>assertProofDecoderClientOutcome(outcome(identity()),{client:value}));}
  assert.throws(()=>assertProofDecoderClientOutcome({}, {get client(){called++;return client;}}));assert.equal(called,0);
});
test('complete identity binds original deadline, boot, installation and every session field',()=>{
  const i=identity();assert.deepEqual(publicationDecoderIdentity(i),i);assert.notEqual(i.stageBinding.requestId,i.prepared.requestId);
  for(const field of Object.keys(i.binding)){const changed=structuredClone(i);changed.stageBinding[field]=field.endsWith('Id')?randomUUID():hash('changed');assert.throws(()=>publicationDecoderIdentity(changed));}
  for(const changed of [{...i,prepared:{...i.prepared,deadlineBootNs:'10000000001'}},{...i,prepared:{...i.prepared,bootId:randomUUID()}},{...i,qualified:true}])assert.throws(()=>publicationDecoderIdentity(changed));
  let touched=false;assert.throws(()=>publicationDecoderIdentity({...i,get prepared(){touched=true;return i.prepared;}}));assert.equal(touched,false);
});
test('settlement data preserves uncertainty, never accepts null requests, or promotes cleanup booleans',()=>{
  const i=identity(),request=outcome(i,'UNKNOWN');assert.equal(publicationDecoderOutcome(request).disposition,'UNKNOWN');assert.throws(()=>publicationDecoderOutcome({...request,request:null}));assert.throws(()=>publicationDecoderOutcome({...request,completion:{cleanupConfirmed:true}}));
  const record={operationId:randomUUID(),dispatchOperationId:randomUUID(),sessionId:i.sessionId,identityHash:hash(i),outcomeHash:hash(request),outcome:request,revision:9};assert.deepEqual(publicationDecoderSettlement(record),record);assert.throws(()=>publicationDecoderSettlement({...record,outcome:{...request,disposition:'KNOWN_NO_START_SENT'}}));
  const dispatch={operationId:randomUUID(),sessionId:i.sessionId,identityHash:hash(i),identity:i,revision:8};assert.deepEqual(publicationDecoderDispatch(dispatch),dispatch);assert.throws(()=>publicationDecoderDispatch({...dispatch,identityHash:hash('borrowed')}));
  const old=publicationHold({operationId:randomUUID(),sessionId:i.sessionId,kind:'DECODE',identityHash:hash(i),revision:8});assert.throws(()=>publicationDecoderDispatch(old));assert.throws(()=>publicationDecoderSettlement(old));
});
test('clean completion must bind the actual original and cannot include a quarantined outcome',()=>{
  const i=identity(),complete={schema:'atlas-proof-decoder-target-broker-v2',classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false,requestId:i.prepared.requestId,nonce:hash('nonce'),bindingHash:i.prepared.bindingHash,jobId:randomUUID(),outcome:'INVALID_IMAGE',reportedCleanup:'OBSERVED',validation:null,bootId:i.prepared.bootId,epoch:i.prepared.epoch};
  const o={...outcome(i,'COMPLETE_CLEAN'),completion:complete};assert.deepEqual(publicationDecoderOutcome(o),o);
  for(const change of [{outcome:'QUARANTINED'},{requestId:randomUUID()},{epoch:'OTHER'},{bindingHash:hash('other')},{reportedCleanup:'UNKNOWN'},{freshPublicationAllowed:true}])assert.throws(()=>publicationDecoderOutcome({...o,completion:{...complete,...change}}));
});
test('dispatch admission reserves one settlement in addition to close and barrier maintenance',()=>{
  const state={revision:10,latestSessionId:randomUUID(),lastCloseHash:hash('close'),sessionCount:1,operationCount:L.operations-3,objectCount:0,originalBytes:0,heldOperationId:null,externalHoldCount:0,unsettledBarrierCount:0};
  publicationCapacity(state);assert.throws(()=>publicationCapacity(state,{pendingDispatches:1}),{code:'PUBLICATION_STORE_FULL'});publicationCapacity({...state,operationCount:L.operations-4},{pendingDispatches:1});assert.throws(()=>publicationCapacity(state,{pendingDispatches:2}));
  publicationCapacity({...state,operationCount:L.operations-1},{maintenance:true,pendingDispatches:1});
});
test('v3 SQLite projections reject handle/stage reuse, terminal replacement and history deletion',()=>{
  const db=new DatabaseSync(':memory:');try{
    for(const sql of Object.values(PUBLICATION_DISPATCH_SQL))db.exec(sql);
    assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name,sql})=>({name,sql})),Object.entries(PUBLICATION_DISPATCH_SQL).sort(([a],[b])=>a.localeCompare(b)).map(([name,sql])=>({name,sql})));
    db.exec("INSERT INTO decoder_dispatches VALUES('a','request','stage',3,'original'); INSERT INTO decoder_settlements VALUES('s','a',4,'unknown'); INSERT INTO decoder_dispatch_migration VALUES(1,2,'migration');");
    for(const sql of ["INSERT INTO decoder_dispatches VALUES('b','request','other',5,'borrowed')","INSERT INTO decoder_dispatches VALUES('b','other','stage',5,'borrowed')","INSERT INTO decoder_settlements VALUES('other','a',5,'clean')","UPDATE decoder_settlements SET record='clean'","UPDATE decoder_dispatches SET record='new'","DELETE FROM decoder_dispatches","DELETE FROM decoder_settlements","DELETE FROM decoder_dispatch_migration"])assert.throws(()=>db.exec(sql));
    assert.equal(db.prepare('SELECT record FROM decoder_settlements').get().record,'unknown');
  }finally{db.close();}
});
test('migration binds the exact previous checkpoint and advances it only once',()=>{
  const m={schema:'atlas-proof-publication-dispatch-migration-v3',migrationId:randomUUID(),priorRevision:9,priorHeadHash:hash('head'),priorStateHash:hash('state'),revision:10};assert.deepEqual(publicationDispatchMigration(m),m);assert.throws(()=>publicationDispatchMigration({...m,revision:11}));assert.throws(()=>publicationDispatchMigration({...m,clearHolds:true}));
});
