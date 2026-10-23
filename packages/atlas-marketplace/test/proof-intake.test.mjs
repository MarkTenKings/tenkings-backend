import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync,writeFileSync,chmodSync,linkSync } from 'node:fs';
import { join } from 'node:path';
import { createMarketplaceProofIntake,assertMarketplaceProofIntake } from '../src/proof-intake.mjs';
import { fixture,image,buyer,staff,stranger,seller,digest } from './proof-fixtures.mjs';
const rejects=(operation,code)=>assert.rejects(async()=>operation(),{code});

test('retains original encrypted bytes across restart and recovers exact upload without review or replacement',async t=>{
  const f=fixture(t),bytes=await image(),prepared=await f.prepare(bytes),result=await f.intake.upload(buyer,{uploadId:prepared.uploadId,bytes});
  assert.equal(prepared.proofId,null);assert.equal(result.status,'RETAINED');assert.equal(result.reviewStatus,'NOT_REVIEWED');
  const files=readdirSync(join(f.directory,'objects'));assert.equal(files.length,1);const encrypted=readFileSync(join(f.directory,'objects',files[0]));assert.equal(encrypted.includes(bytes),false);assert.equal(encrypted.includes(Buffer.from(buyer.id)),false);
  f.reopen();assert.deepEqual(await f.intake.recover(buyer,{uploadId:prepared.uploadId}),result);assert.deepEqual(await f.intake.upload(buyer,{uploadId:prepared.uploadId,bytes}),result);
  const original=await f.intake.read(buyer,{proofId:result.proofId});assert.ok(original.bytes.equals(bytes));assert.equal(original.contentType,'image/png');assert.equal(readdirSync(join(f.directory,'objects')).length,1);
  assert.equal(await f.intake.validateEvidence({kind:'RETURN_REQUEST',actor:buyer,input:{orderId:'demo_order',evidenceRef:result.proofId}}),true);
  assert.equal(f.store.read(s=>s.events.filter(e=>e.type==='MARKETPLACE_PROOF_RETAINED').length),1);
});

test('private order, actor and purpose boundaries reject forged references, sellers and cross-order reuse',async t=>{
  const f=fixture(t),bytes=await image(),proof=await f.retain(bytes);
  for(const actor of [stranger,seller]){await rejects(()=>f.intake.read(actor,{proofId:proof.proofId}),'PROOF_ACCESS_REFUSED');await rejects(()=>f.intake.list(actor,{orderId:'demo_order'}),'PROOF_ACCESS_REFUSED');}
  await rejects(()=>f.intake.upload(stranger,{uploadId:proof.uploadId,bytes}),'PROOF_ACCESS_REFUSED');
  await rejects(()=>f.intake.validateEvidence({kind:'RETURN_REQUEST',actor:buyer,input:{orderId:'demo_order_two',evidenceRef:proof.proofId}}),'PROOF_BINDING_MISMATCH');
  await rejects(()=>f.intake.validateEvidence({kind:'RETURN_REQUEST',actor:buyer,input:{orderId:'demo_order',evidenceRef:'demo_freeform'}}),'PROOF_UNAVAILABLE');
  await rejects(()=>f.intake.validateEvidence({kind:'CONSENT',actor:buyer,input:{orderId:'demo_order',evidenceRef:proof.proofId}}),'PROOF_EVIDENCE_KIND_UNSUPPORTED');
  await rejects(()=>f.prepare(bytes,{requestId:'demo_buyer_pack',purpose:'PACK'}),'PROOF_ACCESS_REFUSED');
  assert.throws(()=>assertMarketplaceProofIntake({...f.intake},{store:f.store}),{code:'PROOF_INTAKE_UNAVAILABLE'});
});

test('byte format, full decode, checksum, exact idempotency and bounded quota are enforced',async t=>{
  const f=fixture(t,{maxProofsPerOrder:3}),bytes=await image(),planned=await f.prepare(bytes);
  await rejects(()=>f.intake.upload(buyer,{uploadId:planned.uploadId,bytes:Buffer.from('forged')}),'PROOF_SOURCE_MISMATCH');
  await rejects(()=>f.prepare(bytes,{purpose:'RETURN_REVIEW'}),'IDEMPOTENCY_CONFLICT');
  const bad=Buffer.from(bytes);bad[bad.length-5]^=0xff;const invalid=await f.prepare(bad,{requestId:'demo_invalid'});
  await rejects(()=>f.intake.upload(buyer,{uploadId:invalid.uploadId,bytes:bad}),'PROOF_IMAGE_INVALID');
  assert.equal((await f.intake.recover(buyer,{uploadId:invalid.uploadId})).status,'REJECTED');
  const mismatch=await f.prepare(bytes,{requestId:'demo_wrong_mime',declaredType:'image/jpeg'});
  await rejects(()=>f.intake.upload(buyer,{uploadId:mismatch.uploadId,bytes}),'PROOF_FORMAT_MISMATCH');
  await rejects(()=>f.prepare(bytes,{requestId:'demo_quota'}),'PROOF_QUOTA_EXCEEDED');
  assert.equal(readdirSync(join(f.directory,'objects')).length,0);
});

test('staff artifact review is separate, immutable and requires an independent current reviewer grant',async t=>{
  const f=fixture(t),bytes=await image('jpeg'),proof=await f.retain(bytes,{actor:staff,purpose:'RELEASE',declaredType:'image/jpeg'});
  const request={kind:'FULFILLMENT',actor:staff,input:{orderId:'demo_order',action:'RELEASE',evidence:{ref:proof.proofId,releaseReviewRef:proof.proofId}}};
  await rejects(()=>f.intake.validateEvidence(request),'PROOF_REVIEW_REQUIRED');
  f.reviewerAllowed=false;await rejects(()=>f.intake.review(staff,{requestId:'demo_review',proofId:proof.proofId,decision:'APPROVE',reviewRef:'demo_actual_review'}),'PROOF_ACCESS_REFUSED');
  f.reviewerAllowed=true;const review=await f.intake.review(staff,{requestId:'demo_review',proofId:proof.proofId,decision:'APPROVE',reviewRef:'demo_actual_review'});
  assert.equal(review.decision,'APPROVE');assert.equal(await f.intake.validateEvidence(request),true);
  assert.deepEqual(await f.intake.review(staff,{requestId:'demo_review',proofId:proof.proofId,decision:'APPROVE',reviewRef:'demo_actual_review'}),review);
  await rejects(()=>f.intake.review(staff,{requestId:'demo_second_review',proofId:proof.proofId,decision:'REJECT',reviewRef:'demo_actual_review'}),'PROOF_REVIEW_CONFLICT');
  f.allowed=false;assert.throws(()=>f.store.transaction(tx=>f.intake.assertInTransaction(tx,request)),{code:'PROOF_ACCESS_REFUSED'});
});

test('buyer evidence and listing remain private; staff proof does not leak into buyer list',async t=>{
  const f=fixture(t),bytes=await image(),own=await f.retain(bytes),staffProof=await f.retain(bytes,{actor:staff,requestId:'demo_staff',purpose:'PACK'});
  assert.deepEqual((await f.intake.list(buyer,{orderId:'demo_order'})).proofs.map(x=>x.proofId),[own.proofId]);
  await rejects(()=>f.intake.read(buyer,{proofId:staffProof.proofId}),'PROOF_ACCESS_REFUSED');
  assert.equal((await f.intake.list(staff,{orderId:'demo_order'})).proofs.length,2);
  const json=JSON.stringify(await f.intake.list(buyer,{orderId:'demo_order'}));for(const privateValue of ['objectKey','retentionRef','reviewerAuthorityRef','actorId',staff.id,'encryptionKey'])assert.equal(json.includes(privateValue),false);
});

test('exact actual-delivery deadline is enforced at upload and starts no later observed-time window',async t=>{
  const f=fixture(t),bytes=await image(),pending=await f.prepare(bytes),end=f.store.read(s=>s.fulfillment.demo_order.releaseNotBefore);
  f.now=end;await rejects(()=>f.intake.upload(buyer,{uploadId:pending.uploadId,bytes}),'RETURN_WINDOW_CLOSED');
  await rejects(()=>f.prepare(bytes,{requestId:'demo_late'}),'RETURN_WINDOW_CLOSED');
  assert.equal(readdirSync(join(f.directory,'objects')).length,0);
});

test('durable original recovers after bytes retained but final state commit fails',async t=>{
  let breakCommit=true;
  const f=fixture(t,{transactionHook:tx=>{if(breakCommit&&Object.values(tx.state.marketplaceProofUploads??{}).some(row=>row.status==='RETAINED'))throw Object.assign(new Error('simulated lost commit'),{code:'TEST_COMMIT_LOST'});}}),bytes=await image(),pending=await f.prepare(bytes);
  await rejects(()=>f.intake.upload(buyer,{uploadId:pending.uploadId,bytes}),'TEST_COMMIT_LOST');
  assert.equal(f.store.read(s=>s.marketplaceProofUploads[pending.uploadId].status),'VALIDATED');assert.equal(readdirSync(join(f.directory,'objects')).length,1);
  breakCommit=false;f.reopen();const recovered=await f.intake.recover(buyer,{uploadId:pending.uploadId});assert.equal(recovered.status,'RETAINED');assert.ok((await f.intake.read(buyer,{proofId:recovered.proofId})).bytes.equals(bytes));assert.equal(readdirSync(join(f.directory,'objects')).length,1);
});

test('authorization revoked while full decode awaits prevents object publication',async t=>{
  const f=fixture(t),bytes=await image(),pending=await f.prepare(bytes),operation=f.intake.upload(buyer,{uploadId:pending.uploadId,bytes});
  // upload awaits the state read before claiming. Wait until the persisted
  // worker lease exists; the child decoder has not yet returned.
  while(f.store.read(s=>s.marketplaceProofUploads[pending.uploadId].status)!=='VALIDATING')await new Promise(r=>setImmediate(r));
  f.allowed=false;await assert.rejects(operation,{code:'PROOF_ACCESS_REFUSED'});assert.equal(readdirSync(join(f.directory,'objects')).length,0);
  assert.equal(f.store.read(s=>Object.keys(s.marketplaceProofObjects??{}).length),0);
});

test('encrypted original tampering fails private reads and evidence validation',async t=>{
  const f=fixture(t),bytes=await image(),proof=await f.retain(bytes),filename=join(f.directory,'objects',readdirSync(join(f.directory,'objects'))[0]),envelope=JSON.parse(readFileSync(filename));
  envelope.ciphertext=(envelope.ciphertext[0]==='A'?'B':'A')+envelope.ciphertext.slice(1);chmodSync(filename,0o600);writeFileSync(filename,JSON.stringify(envelope));chmodSync(filename,0o400);
  await rejects(()=>f.intake.read(buyer,{proofId:proof.proofId}),'PROOF_STORAGE_CORRUPT');
  await rejects(()=>f.intake.validateEvidence({kind:'RETURN_REQUEST',actor:buyer,input:{orderId:'demo_order',evidenceRef:proof.proofId}}),'PROOF_STORAGE_CORRUPT');
});


test('review request reuse cannot approve a second original and service guard is rechecked',async t=>{
  const f=fixture(t),bytes=await image(),first=await f.retain(bytes,{actor:staff,purpose:'PACK'}),second=await f.retain(bytes,{actor:staff,purpose:'PACK',requestId:'demo_second_upload'});
  await f.intake.review(staff,{requestId:'demo_one_review',proofId:first.proofId,decision:'APPROVE',reviewRef:'demo_review_reference'});
  await rejects(()=>f.intake.review(staff,{requestId:'demo_one_review',proofId:second.proofId,decision:'APPROVE',reviewRef:'demo_review_reference'}),'IDEMPOTENCY_CONFLICT');
  await rejects(()=>f.intake.read(staff,{proofId:first.proofId},{authorizeCommit:()=>false}),'PROOF_ACCESS_REFUSED');
  await rejects(()=>f.intake.prepare(buyer,{requestId:'demo_blocked',orderId:'demo_order',purpose:'RETURN_REQUEST',declaredType:'image/png',byteCount:bytes.length,sha256:digest(bytes)},{authorizeCommit:()=>false}),'PROOF_ACCESS_REFUSED');
  assert.equal(f.store.read(s=>Object.keys(s.marketplaceProofReviews).length),1);
});


test('canonical authority refresh after actual decode can refuse publication and retained commit',async t=>{
  const f=fixture(t),bytes=await image(),plan=await f.prepare(bytes);let refreshes=0;
  await rejects(()=>f.intake.upload(buyer,{uploadId:plan.uploadId,bytes},{refreshAuthorization:async()=>{
    refreshes++;await new Promise(resolve=>setImmediate(resolve));
    return f.store.read(s=>s.marketplaceProofUploads[plan.uploadId].status)!=='VALIDATING';
  }}),'PROOF_ACCESS_REFUSED');
  assert.equal(refreshes,2);assert.equal(f.store.read(s=>s.marketplaceProofUploads[plan.uploadId].status),'VALIDATING');
  assert.equal(readdirSync(join(f.directory,'objects')).length,0);
  assert.equal(f.store.read(s=>Object.keys(s.marketplaceProofObjects??{}).length),0);
});

test('async refresh refusal prevents prepare and reviewer commits and withholds private bytes',async t=>{
  const f=fixture(t),bytes=await image(),refused={refreshAuthorization:async()=>false};
  await rejects(()=>f.intake.prepare(buyer,{requestId:'demo_refused_prepare',orderId:'demo_order',purpose:'RETURN_REQUEST',declaredType:'image/png',byteCount:bytes.length,sha256:digest(bytes)},refused),'PROOF_ACCESS_REFUSED');
  assert.equal(f.store.read(s=>Object.keys(s.marketplaceProofUploads??{}).length),0);
  const proof=await f.retain(bytes,{actor:staff,purpose:'PACK'});
  await rejects(()=>f.intake.review(staff,{requestId:'demo_refused_review',proofId:proof.proofId,decision:'APPROVE',reviewRef:'demo_review'},refused),'PROOF_ACCESS_REFUSED');
  assert.equal(f.store.read(s=>Object.keys(s.marketplaceProofReviews??{}).length),0);
  await rejects(()=>f.intake.read(staff,{proofId:proof.proofId},refused),'PROOF_ACCESS_REFUSED');
  await rejects(()=>f.intake.list(staff,{orderId:'demo_order'},refused),'PROOF_ACCESS_REFUSED');
});

test('authorization refresh cannot extend the actual delivery or upload deadline before publication',async t=>{
  for(const expected of ['PROOF_UPLOAD_EXPIRED','RETURN_WINDOW_CLOSED']){
    const f=fixture(t),bytes=await image(),returnDeadline=f.store.read(s=>s.fulfillment.demo_order.releaseNotBefore);
    if(expected==='RETURN_WINDOW_CLOSED')f.now=returnDeadline-1000;
    const plan=await f.prepare(bytes);
    await rejects(()=>f.intake.upload(buyer,{uploadId:plan.uploadId,bytes},{refreshAuthorization:async()=>{
      if(f.store.read(s=>s.marketplaceProofUploads[plan.uploadId].status)==='VALIDATED')f.now=expected==='RETURN_WINDOW_CLOSED'?returnDeadline:plan.expiresAt;
      return true;
    }}),expected);
    assert.equal(readdirSync(join(f.directory,'objects')).length,0);
    assert.equal(f.store.read(s=>Object.keys(s.marketplaceProofObjects??{}).length),0);
  }
});

test('actor-free readiness still requires current policy, runtime and actual storage readiness',async t=>{
  const f=fixture(t);f.allowed=false;assert.equal(f.intake.assertReady(),true);
  f.runtimeReady=false;assert.throws(()=>f.intake.assertReady(),{code:'PROOF_RUNTIME_UNAVAILABLE'});f.runtimeReady=true;
  f.now=f.policy.expiresAt;assert.throws(()=>f.intake.assertReady(),{code:'PROOF_POLICY_UNAVAILABLE'});f.now=f.policy.effectiveAt+1;
  f.storage.close();assert.throws(()=>f.intake.assertReady(),{code:'PROOF_STORAGE_UNAVAILABLE'});
});
