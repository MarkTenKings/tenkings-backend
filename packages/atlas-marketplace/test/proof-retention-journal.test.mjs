import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clone,hash} from '../src/contract.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createProofRetentionJournal} from '../src/proof-retention-journal.mjs';
import {syntheticRetentionFixture,seedSyntheticRetention} from '../scripts/qualify-proof-retention-journal.mjs';

function fixture(t,{maxOperations=4,adapter}={}){
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>1000}),f=syntheticRetentionFixture();store.transaction(tx=>seedSyntheticRetention(tx,f));
  const journal=createProofRetentionJournal({enabled:true,store:adapter?adapter(store):store,binding:f.binding,maxOperations});t.after(()=>{journal.close();store.close();});return {...f,store,journal};
}
const commit=f=>f.journal.commitRetention({operation:f.operation});
const lookup=f=>f.journal.lookupRetention({operation:f.operation});
const barrier=f=>({operation:f.operation,barrierId:randomUUID(),barrierRevision:f.operation.retentionFenceRevision+1});
const code=(action,expected)=>assert.throws(action,{code:expected});

test('default off, closed options/data and no callback or fake authority seams',t=>{
  assert.equal(createProofRetentionJournal(),null);assert.equal(createProofRetentionJournal({enabled:false}),null);
  for(const key of ['authorize','publisher','qualified','clock'])assert.throws(()=>createProofRetentionJournal({enabled:false,[key]:true}));
  let calls=0;assert.throws(()=>createProofRetentionJournal({get enabled(){calls++;return true;}}));assert.equal(calls,0);
  const f=fixture(t);assert.throws(()=>f.journal.commitRetention({operation:f.operation,authorized:true}));
  assert.throws(()=>f.journal.commitRetention({operation:{...f.operation,qualification:{approved:true}}}));
  assert.throws(()=>f.journal.commitRetention({get operation(){calls++;return f.operation;}}));assert.equal(calls,0);
  for(const count of [0,4097,NaN,1.5])assert.throws(()=>createProofRetentionJournal({enabled:true,store:f.store,binding:f.binding,maxOperations:count}));
  assert.equal(f.journal.customerPublicationAuthority,false);assert.equal(f.journal.retentionAuthority,false);
});
test('one CAS retains exact legacy object/row/event and exact duplicate returns the original projection',t=>{
  const f=fixture(t),original=clone(f.row),result=commit(f),state=f.store.read();
  assert.equal(result.classification,'UNQUALIFIED');assert.equal(result.disposition,'COMMITTED');assert.equal(result.retentionAuthority,false);
  const row=state.marketplaceProofUploads[f.row.uploadId];assert.deepEqual(row,{...original,status:'RETAINED',completedAt:1000});
  assert.deepEqual(state.marketplaceProofObjects[f.row.proofId],{proofId:f.row.proofId,uploadId:f.row.uploadId,objectKey:f.row.objectKey,manifest:original.manifest,manifestHash:hash(original.manifest),retainedAt:1000});
  assert.deepEqual(state.events[0],{sequence:1,type:'MARKETPLACE_PROOF_RETAINED',payload:{proofId:f.row.proofId,orderId:f.row.orderId,purpose:f.row.purpose,actorId:f.row.actorId},at:1000,environment:'SYNTHETIC_LOCAL'});
  assert.deepEqual(commit(f),result);assert.deepEqual(lookup(f),result);assert.equal(f.store.read(s=>s.events.length),1);
  f.store.transaction(tx=>{(tx.state.marketplaceProofReviews??={})[f.row.proofId]={decision:'APPROVE'};tx.state.intents[f.order.paymentIntentId].status='LATER_CHANGED';});
  assert.deepEqual(lookup(f),result);assert.equal(result.record.result.reviewStatus,'NOT_REVIEWED');
});
test('every immutable operation field conflicts on reuse, and alternate IDs cannot rebind publication/upload',t=>{
  const f=fixture(t);commit(f);const stateHash=hash(f.store.read());
  for(const key of Object.keys(f.operation)){
    let value=f.operation[key];if(typeof value==='number')value++;else if(key==='actorRole')value='STAFF';else if(key==='schema')value+='x';else if(value.startsWith('demo_'))value+='x';else if(/^[a-f0-9]{64}$/.test(value))value=(value[0]==='a'?'b':'a')+value.slice(1);else value=randomUUID();
    assert.throws(()=>f.journal.commitRetention({operation:{...f.operation,[key]:value}}),key);
  }
  code(()=>f.journal.lookupRetention({operation:{...f.operation,operationId:randomUUID()}}),'PROOF_RETENTION_CONFLICT');assert.equal(hash(f.store.read()),stateHash);
});
test('stale exact upload, invalid legacy states and incompatible manifest/order/payment never partly retain',t=>{
  for(const mutate of [r=>{r.attempts++;},r=>{r.status='VALIDATING';},r=>{r.status='REJECTED';},r=>{r.status='RETAINED';},r=>{r.manifest.validation.width++;},r=>{r.actorId='demo_other';}]){
    const f=fixture(t);f.store.transaction(tx=>mutate(tx.state.marketplaceProofUploads[f.row.uploadId]));const before=hash(f.store.read());assert.throws(()=>commit(f));assert.equal(hash(f.store.read()),before);
  }
  for(const mutate of [(s,f)=>{s.orders[f.order.orderId].buyerId='demo_other';},(s,f)=>{s.intents[f.order.paymentIntentId].confirmed=false;}]){
    const f=fixture(t);f.store.transaction(tx=>mutate(tx.state,f));assert.throws(()=>commit(f));assert.equal(f.store.read(s=>s.marketplaceProofRetentionOperations),undefined);
  }
});
test('tombstone wins before commit, stays idempotent and permanently rejects the late exact or replacement ID',t=>{
  const f=fixture(t),b=barrier(f),cancelled=f.journal.cancelBeforeCommit(b);assert.equal(cancelled.disposition,'CANCELLED_BEFORE_COMMIT');assert.deepEqual(f.journal.cancelBeforeCommit(b),cancelled);assert.deepEqual(lookup(f),cancelled);
  code(()=>commit(f),'PROOF_RETENTION_CANCELLED_HOLD');code(()=>f.journal.commitRetention({operation:{...f.operation,operationId:randomUUID()}}),'PROOF_RETENTION_CONFLICT');
  code(()=>f.journal.cancelBeforeCommit({...b,barrierId:randomUUID()}),'PROOF_RETENTION_CONFLICT');assert.throws(()=>f.journal.cancelBeforeCommit({...b,barrierRevision:f.operation.retentionFenceRevision}));
  const reopened=createProofRetentionJournal({enabled:true,store:f.store,binding:f.binding,maxOperations:4});code(()=>reopened.commitRetention({operation:f.operation}),'PROOF_RETENTION_CANCELLED_HOLD');assert.deepEqual(reopened.lookupRetention({operation:f.operation}),cancelled);reopened.close();
  assert.deepEqual(f.store.read(s=>s.marketplaceProofUploads[f.row.uploadId]),f.row);assert.equal(f.store.read(s=>s.marketplaceProofObjects),undefined);assert.equal(f.store.read(s=>s.events.length),1);
});
test('committed original wins a racing barrier and cannot be cancelled or emit again',t=>{
  const f=fixture(t),first=commit(f);assert.deepEqual(f.journal.cancelBeforeCommit(barrier(f)),first);assert.equal(f.store.read(s=>s.events.length),1);assert.equal(lookup(f).record.barrier,null);
});
test('unknown after commit is looked up exactly; unknown before commit stays ABSENT_HOLD with no retry',async t=>{
  for(const applied of [false,true]){
    let calls=0;const unknown=Object.assign(new Error('operator fixture lost reply'),{code:'STORE_COMMIT_UNKNOWN'});
    const f=fixture(t,{adapter:store=>({read:store.read,transaction(fn){calls++;if(applied)store.transaction(fn);return Promise.reject(unknown);}})});
    const before=hash(f.store.read());await assert.rejects(async()=>commit(f),error=>error===unknown);assert.equal(calls,1);
    const result=await lookup(f);assert.equal(result.disposition,applied?'COMMITTED':'ABSENT_HOLD');assert.equal(calls,1);code(()=>commit(f),'PROOF_RETENTION_UNKNOWN_HOLD');assert.equal(calls,1);
    if(!applied){assert.equal(hash(f.store.read()),before);assert.equal(result.record,null);}else assert.equal(f.store.read(s=>s.events.length),1);
  }
});
test('transaction failure rolls back object, row, event and operation together',t=>{
  const f=fixture(t,{adapter:store=>({read:store.read,transaction(fn){return store.transaction(tx=>{fn(tx);throw new Error('external fixture interruption before commit');});}})});
  const before=hash(f.store.read());assert.throws(()=>commit(f),/external fixture/);assert.equal(hash(f.store.read()),before);assert.equal(lookup(f).disposition,'ABSENT_HOLD');
});
test('unknown barrier is lookup-only, while an explicit barrier may settle an unknown original dispatch',async t=>{
  const unknown=Object.assign(new Error('operator fixture unknown barrier reply'),{code:'STORE_COMMIT_UNKNOWN'});
  for(const applied of [false,true]){
    let calls=0;const f=fixture(t,{adapter:store=>({read:store.read,transaction(fn){calls++;if(applied)store.transaction(fn);throw unknown;}})}),b=barrier(f);
    assert.throws(()=>f.journal.cancelBeforeCommit(b),error=>error===unknown);assert.equal(lookup(f).disposition,applied?'CANCELLED_BEFORE_COMMIT':'ABSENT_HOLD');
    code(()=>f.journal.cancelBeforeCommit(b),'PROOF_RETENTION_UNKNOWN_HOLD');code(()=>commit(f),'PROOF_RETENTION_UNKNOWN_HOLD');assert.equal(calls,1);
  }
  let first=true;const f=fixture(t,{adapter:store=>({read:store.read,transaction(fn){if(first){first=false;throw unknown;}return store.transaction(fn);}})});
  assert.throws(()=>commit(f),error=>error===unknown);assert.equal(lookup(f).disposition,'ABSENT_HOLD');assert.equal(f.journal.cancelBeforeCommit(barrier(f)).disposition,'CANCELLED_BEFORE_COMMIT');code(()=>commit(f),'PROOF_RETENTION_UNKNOWN_HOLD');
});
test('an in-flight original dispatch cannot be duplicated before its unknown response',async t=>{
  let fail,calls=0;const f=fixture(t,{adapter:store=>({read:store.read,transaction(){calls++;return new Promise((resolve,reject)=>{fail=reject;});}})});
  const first=commit(f);code(()=>commit(f),'PROOF_RETENTION_PENDING_HOLD');assert.equal(lookup(f).disposition,'ABSENT_HOLD');assert.equal(calls,1);
  const unknown=Object.assign(new Error('external pending commit fixture'),{code:'STORE_COMMIT_UNKNOWN'});fail(unknown);await assert.rejects(first,error=>error===unknown);code(()=>commit(f),'PROOF_RETENTION_UNKNOWN_HOLD');assert.equal(calls,1);
});
test('bounded journal rejects new work at capacity but preserves exact duplicate and lookup',t=>{
  const f=fixture(t,{maxOperations:1}),first=commit(f),second=syntheticRetentionFixture('two');f.store.transaction(tx=>seedSyntheticRetention(tx,second));
  code(()=>f.journal.commitRetention({operation:second.operation}),'PROOF_RETENTION_CAPACITY_HOLD');assert.deepEqual(commit(f),first);assert.deepEqual(lookup(f),first);assert.equal(f.journal.lookupRetention({operation:second.operation}).disposition,'ABSENT_HOLD');
  const other=createProofRetentionJournal({enabled:true,store:f.store,binding:f.binding,maxOperations:2});code(()=>other.lookupRetention({operation:f.operation}),'PROOF_RETENTION_JOURNAL_HOLD');other.close();
});
test('stored record/index/original corruption holds and close never closes the shared store',t=>{
  for(const mutate of [(s,f)=>{s.marketplaceProofRetentionOperations[f.operation.operationId].operationHash='0'.repeat(64);},(s,f)=>{delete s.marketplaceProofRetentionUploadIndex[f.row.uploadId];},(s,f)=>{s.marketplaceProofObjects[f.row.proofId].manifest.validation.width++;},(s,f)=>{s.marketplaceProofUploads[f.row.uploadId].attempts++;}]){
    const f=fixture(t);commit(f);f.store.transaction(tx=>mutate(tx.state,f));assert.throws(()=>lookup(f));
  }
  const f=fixture(t);f.journal.close();code(()=>lookup(f),'PROOF_RETENTION_CLOSED');assert.ok(f.store.read());
});
