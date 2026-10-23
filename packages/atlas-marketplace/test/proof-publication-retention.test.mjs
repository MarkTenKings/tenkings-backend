import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {hash} from '../src/contract.mjs';
import {openProofPublicationRetentionStore,migrateProofPublicationLedgerV4} from '../src/proof-publication-store.mjs';
import {PUBLICATION_RETENTION_SQL,publicationRetentionIdentity,publicationRetentionOutcome,publicationRetentionSettlement,publicationRetentionMigration,publicationRetentionOperation} from '../src/proof-publication-retention.mjs';
const h=label=>hash(label),id=randomUUID;
function identity(){
 const intake={schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:h('policy'),storageHash:h('storage')},binding={installationId:id(),qualificationSessionId:id(),qualificationEvidenceHash:h('qualification'),sourceClosureHash:h('closure'),policyHash:intake.policyHash,intakeBindingHash:h(intake)};
 const connection={schema:'atlas-proof-retention-postgres-connection-v1',database:'fixture_db',role:'fixture_writer',functionOwner:'fixture_owner',endpoint:{kind:'LOCAL_UNIX',directory:'/fixed/fixture',port:55492},driverInventoryHash:h('driver'),functionDefinitionHashes:{'read_state()':h('read'),'lock_state()':h('lock'),'commit_state(bigint, text, jsonb, text, bigint)':h('commit')}};connection.bindingHash=h(connection);
 const writerBinding={schema:'atlas-proof-retention-writer-binding-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,intakeBinding:intake,connection,maxOperations:16},ledgerId=id(),sessionId=id();
 const operation={schema:'atlas-proof-retention-operation-v1',operationId:id(),uploadId:'demo_upload',proofId:'demo_proof',orderId:'demo_order',orderHash:h('order'),actorId:'demo_actor',actorRole:'BUYER',actorAccessBindingHash:h('actor'),originalRequestHash:h('request'),policyHash:intake.policyHash,intakeBindingHash:h(intake),objectKey:h({binding:intake,uploadId:'demo_upload'}),manifestHash:h('manifest'),originalSha256:h('bytes'),originalByteCount:10,validationAttemptId:id(),decoderRequestId:id(),publicationLedgerId:ledgerId,publicationSessionId:sessionId,publicationOperationId:id(),publicationRevision:10,publicationEvidenceHash:h('publication'),qualificationSessionId:binding.qualificationSessionId,retentionFenceRevision:11,expectedUploadHash:h('upload')};
 const prepared={schema:'atlas-proof-retention-prepared-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,writerBindingHash:h(writerBinding),operationHash:h(operation),operation};
 const stageBinding={...binding,stageId:id(),stageRevision:11,requestId:id(),requestBindingHash:h('request-binding'),actorAccessBindingHash:operation.actorAccessBindingHash,operationHash:h(operation),bootId:id(),deadlineBootNs:'123456789',fences:[{fenceId:id(),sourceKind:'POLICY',sourceKeyHash:h('policy-source'),sourceGenerationHash:h('generation'),ordinal:1,revision:1}]};return {schema:'atlas-proof-publication-retention-identity-v1',ledgerId,sessionId,binding,stageBinding,writerBinding,prepared};
}
function observed(i,disposition='UNKNOWN'){
 const o=i.prepared.operation,v={schema:'atlas-proof-retention-writer-outcome-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,writerBindingHash:i.prepared.writerBindingHash,operationHash:h(o),operation:o,action:'LOOKUP',disposition,report:null};
 if(disposition!=='UNKNOWN')v.report={schema:'atlas-proof-retention-journal-report-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,operationId:o.operationId,operationHash:h(o),disposition,record:disposition==='ABSENT_HOLD'?null:{schema:'atlas-proof-retention-record-v1',operation:o,operationHash:h(o),phase:disposition,recordedAt:100,result:null,retainedUploadHash:null,proofObjectHash:null,barrier:{barrierId:id(),barrierRevision:12}}};return v;
}
test('v4 IO/migration remain default-off and reject fake observer without filesystem access',()=>{
 assert.equal(openProofPublicationRetentionStore(),null);assert.equal(migrateProofPublicationLedgerV4(),null);
 assert.throws(()=>openProofPublicationRetentionStore({enabled:true,linuxObserver:{boottimeNanoseconds(){throw new Error('must not call');}}}));
});
test('full retention identity binds publisher/session, installed intake, actor access and the exact original stage revision',()=>{
 const i=identity();assert.deepEqual(publicationRetentionIdentity(i),i);
 for(const mutation of [x=>x.sessionId=id(),x=>x.ledgerId=id(),x=>x.stageBinding.stageRevision++,x=>x.stageBinding.actorAccessBindingHash=h('other'),x=>x.stageBinding.operationHash=h('other'),x=>x.writerBinding.intakeBinding.storageHash=h('other'),x=>x.prepared.operation.publicationRevision=0]){const bad=structuredClone(i);mutation(bad);assert.throws(()=>publicationRetentionIdentity(bad));}
});
test('unresolved observations stay nonterminal and exact original cancellation needs a later durable barrier',()=>{
 const i=identity();for(const disposition of ['UNKNOWN','ABSENT_HOLD','CANCELLED_BEFORE_COMMIT'])assert.equal(publicationRetentionOutcome(observed(i,disposition),i).disposition,disposition);
 const bad=observed(i,'CANCELLED_BEFORE_COMMIT');bad.report.record.barrier.barrierRevision=i.prepared.operation.retentionFenceRevision;assert.throws(()=>publicationRetentionOutcome(bad,i));
 const unknown=observed(i);unknown.report={disposition:'COMMITTED'};assert.throws(()=>publicationRetentionOutcome(unknown,i));
 const wrong=observed(i,'ABSENT_HOLD');wrong.operation={...wrong.operation,operationId:id()};assert.throws(()=>publicationRetentionOutcome(wrong,i));
});
test('retention settlement data cannot relabel unknown as terminal or replace the original operation',()=>{
 const i=identity(),outcome=observed(i),s={operationId:id(),dispatchOperationId:id(),sessionId:i.sessionId,identityHash:h(i),identity:i,outcomeHash:h(outcome),outcome,kind:'UNRESOLVED',revision:12};assert.equal(publicationRetentionSettlement(s).kind,'UNRESOLVED');assert.throws(()=>publicationRetentionSettlement({...s,kind:'TERMINAL'}));
 const request={dispatchOperationId:s.dispatchOperationId,identityHash:s.identityHash,outcomeHash:s.outcomeHash},op={operationId:s.operationId,kind:'RETAIN_UNRESOLVED',request,phase:'COMPLETED',intentRevision:12,completedRevision:12,revision:12};assert.deepEqual(publicationRetentionOperation(op),op);assert.throws(()=>publicationRetentionOperation({...op,completedRevision:11}));
});
test('v4 SQL preserves separate immutable unknown and terminal slots and forbids third observations',()=>{
 const db=new DatabaseSync(':memory:');try{for(const sql of Object.values(PUBLICATION_RETENTION_SQL))db.exec(sql);const insert=db.prepare('INSERT INTO retention_settlements VALUES(?,?,?,?,?)');insert.run('unknown','dispatch','UNRESOLVED',1,'{}');insert.run('done','dispatch','TERMINAL',2,'{}');assert.throws(()=>insert.run('third','dispatch','TERMINAL',3,'{}'));assert.throws(()=>insert.run('repeat','dispatch','UNRESOLVED',3,'{}'));assert.throws(()=>insert.run('extra','dispatch','OTHER',3,'{}'));assert.throws(()=>db.exec("UPDATE retention_settlements SET record='changed'"));assert.throws(()=>db.exec('DELETE FROM retention_settlements'));assert.equal(db.prepare('SELECT count(*) n FROM retention_settlements').get().n,2);}finally{db.close();}
});
test('migration data only advances exactly one revision and never rewrites prior hash/state',()=>{
 const m={schema:'atlas-proof-publication-retention-migration-v4',migrationId:id(),priorRevision:10,priorHeadHash:h('head'),priorStateHash:h('state'),revision:11};assert.deepEqual(publicationRetentionMigration(m),m);assert.throws(()=>publicationRetentionMigration({...m,revision:12}));assert.throws(()=>publicationRetentionMigration({...m,oldHoldReset:true}));
});
test('committed original projection binds immutable proof/original fields and admits no authority label',()=>{
 const i=identity(),o=i.prepared.operation,v=observed(i,'COMMITTED'),row=v.report.record;row.barrier=null;row.retainedUploadHash=h('retained');row.proofObjectHash=h('object');row.result={uploadId:o.uploadId,proofId:o.proofId,orderId:o.orderId,purpose:'RETURN_REQUEST',status:'RETAINED',declaredType:'image/png',byteCount:o.originalByteCount,sha256:o.originalSha256,expiresAt:200,createdAt:1,reviewStatus:'NOT_REVIEWED'};assert.equal(publicationRetentionOutcome(v,i).disposition,'COMMITTED');
 const bad=structuredClone(v);bad.report.record.result.proofId='demo_other';assert.throws(()=>publicationRetentionOutcome(bad,i));assert.throws(()=>publicationRetentionOutcome({...v,retentionAuthority:true},i));
});
