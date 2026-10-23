// Root-operated isolated PostgreSQL fixture only. No environment/credentials,
// connection discovery, DDL, seeding an empty database, reset or cleanup here.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {clone,hash} from '../src/contract.mjs';
import {createPostgresStore,emptyMarketplaceState} from '../src/store-postgres.mjs';
import {createProofRetentionJournal} from '../src/proof-retention-journal.mjs';
import {PROOF_DECODER_VERSION} from '../src/proof-decoder-protocol.mjs';

/** Synthetic observations only; no private actor, decoder or publisher brand. */
export function syntheticRetentionFixture(suffix='one'){
  assert.match(suffix,/^[a-z0-9_]{1,24}$/);
  const binding={schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:hash('fixture-policy'),storageHash:hash('fixture-storage')};
  const order={orderId:'demo_order_'+suffix,cardId:'demo_card_'+suffix,buyerId:'demo_buyer',sellerId:'demo_seller',bindingHash:hash('fixture-order-'+suffix),policyVersion:'fixture-policy-v1',paymentIntentId:'demo_payment_'+suffix};
  const orderBinding=Object.fromEntries(['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion'].map(key=>[key,order[key]]));
  const plan={declaredType:'image/png',byteCount:17,sha256:hash('unverified synthetic bytes '+suffix)},uploadId='demo_upload_'+suffix,proofId='demo_proof_'+suffix;
  const manifest={schema:'atlas-marketplace-retained-proof-v1',proofId,uploadId,environment:binding.environment,storageId:'fixture-storage',retentionRef:'fixture-retention',retainUntil:10000000,createdAt:1,validatedAt:2,policyHash:binding.policyHash,orderBinding,actorId:order.buyerId,actorRole:'BUYER',purpose:'RETURN_REQUEST',byteCount:plan.byteCount,sha256:plan.sha256,validation:{schema:'atlas-marketplace-proof-image-v1',decoder:PROOF_DECODER_VERSION,contentType:plan.declaredType,byteCount:plan.byteCount,sha256:plan.sha256,width:2,height:3}};
  const row={uploadId,proofId,objectKey:hash({binding,uploadId}),requestHash:hash('fixture-request-'+suffix),actorId:order.buyerId,actorRole:'BUYER',orderId:order.orderId,orderBinding,orderHash:hash(orderBinding),purpose:'RETURN_REQUEST',plan,status:'VALIDATED',createdAt:1,expiresAt:900000,retainUntil:manifest.retainUntil,attempts:2,policyHash:binding.policyHash,manifest};
  const operation={schema:'atlas-proof-retention-operation-v1',operationId:randomUUID(),uploadId,proofId,orderId:order.orderId,orderHash:row.orderHash,actorId:row.actorId,actorRole:row.actorRole,actorAccessBindingHash:hash('unverified fixture access'),originalRequestHash:row.requestHash,policyHash:binding.policyHash,intakeBindingHash:hash(binding),objectKey:row.objectKey,manifestHash:hash(manifest),originalSha256:plan.sha256,originalByteCount:plan.byteCount,validationAttemptId:randomUUID(),decoderRequestId:randomUUID(),publicationLedgerId:randomUUID(),publicationSessionId:randomUUID(),publicationOperationId:randomUUID(),publicationRevision:2,publicationEvidenceHash:hash('unverified fixture publication'),qualificationSessionId:randomUUID(),retentionFenceRevision:3,expectedUploadHash:hash(row)};
  return {binding,row,order,operation,payment:{kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:order.orderId,bindingHash:order.bindingHash}};
}
export function seedSyntheticRetention(tx,fixture){
  assert.equal(tx.state.orders[fixture.order.orderId],undefined);assert.equal(tx.state.intents[fixture.order.paymentIntentId],undefined);
  tx.state.orders[fixture.order.orderId]=clone(fixture.order);tx.state.intents[fixture.order.paymentIntentId]=clone(fixture.payment);
  (tx.state.marketplaceProofUploads??={})[fixture.row.uploadId]=clone(fixture.row);
}

/** Called only by root's trusted operator composition with an already-created
 * pool for a freshly initialized, isolated SYNTHETIC_LOCAL database. The real
 * createPostgresStore performs its existing per-connection role/grant audit. */
export async function qualifyProofRetentionJournalPostgres({pool,expectedRole,expectedDatabase,expectedFunctionOwner}){
  const store=createPostgresStore({enabled:true,pool,environment:'SYNTHETIC_LOCAL',expectedRole,expectedDatabase,expectedFunctionOwner});let journal;
  try{
    assert.deepEqual(await store.read(),emptyMarketplaceState());
    const fixtures=['committed','cancelled','race','absent'].map(syntheticRetentionFixture);
    await store.transaction(tx=>{for(const fixture of fixtures)seedSyntheticRetention(tx,fixture);});
    journal=createProofRetentionJournal({enabled:true,store,binding:fixtures[0].binding,maxOperations:4});
    const first=await journal.commitRetention({operation:fixtures[0].operation});assert.equal(first.disposition,'COMMITTED');assert.deepEqual(await journal.commitRetention({operation:fixtures[0].operation}),first);assert.deepEqual(await journal.lookupRetention({operation:fixtures[0].operation}),first);
    const barrier={operation:fixtures[1].operation,barrierId:randomUUID(),barrierRevision:4};const cancelled=await journal.cancelBeforeCommit(barrier);assert.equal(cancelled.disposition,'CANCELLED_BEFORE_COMMIT');assert.deepEqual(await journal.cancelBeforeCommit(barrier),cancelled);await assert.rejects(async()=>journal.commitRetention({operation:fixtures[1].operation}),{code:'PROOF_RETENTION_CANCELLED_HOLD'});
    const race={operation:fixtures[2].operation,barrierId:randomUUID(),barrierRevision:4};const contenders=await Promise.allSettled([journal.commitRetention({operation:race.operation}),journal.cancelBeforeCommit(race)]);
    const settled=await journal.lookupRetention({operation:race.operation});assert.ok(['COMMITTED','CANCELLED_BEFORE_COMMIT'].includes(settled.disposition));assert.ok(contenders.some(value=>value.status==='fulfilled'));
    for(const result of contenders)if(result.status==='rejected')assert.equal(result.reason.code,'PROOF_RETENTION_CANCELLED_HOLD');
    assert.equal((await journal.lookupRetention({operation:fixtures[3].operation})).disposition,'ABSENT_HOLD');
    const state=await store.read();assert.equal(Object.keys(state.marketplaceProofRetentionOperations).length,3);
    assert.equal(state.events.filter(event=>event.type==='MARKETPLACE_PROOF_RETAINED').length,settled.disposition==='COMMITTED'?2:1);
    assert.equal(state.events.filter(event=>event.type==='MARKETPLACE_PROOF_RETENTION_CANCELLED').length,settled.disposition==='COMMITTED'?1:2);
    return {classification:'UNQUALIFIED',evidenceScope:'ACTUAL_POSTGRES_STORAGE_ONLY',cases:4,operations:fixtures.map(value=>value.operation),race:settled.disposition,notRun:['lost COMMIT response injection','canonical authority/revocation integration','publisher storage or decoder integration'],retainedFixtureStateHash:hash(state)};
  }finally{journal?.close();store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)throw new Error('OPERATOR_COMPOSITION_REQUIRED_NO_CREDENTIAL_DISCOVERY');
