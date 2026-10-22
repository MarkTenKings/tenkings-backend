import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ownershipLifecycleInput as input, ownershipProofCanonical as canonical, ownershipProofPlanHash as hash,
 ownershipProofObjectPlan, ownershipProofObjectObservation, projectOwnershipLifecycle, OWNERSHIP_PROOF_DEFAULTS, OWNERSHIP_PROOF_VALIDATORS } from '../src/card-ownership-proof-contract.mjs';
export const card={cardId:randomUUID(),approvalActionId:randomUUID(),approvalReportHash:'a'.repeat(64),certificateNumber:'ATLAS-ABCDEF123456',report:{publicToken:'ar_'+'a'.repeat(24),version:1,publicHash:'b'.repeat(64)}};
export function objectPlan(){const bundleId=randomUUID(),objectId=randomUUID(),p={schema:'atlas-ownership-proof-object-plan-v2',bundleId,objectId,accountId:randomUUID(),cardId:card.cardId,
 approvalActionId:card.approvalActionId,approvalReportHash:card.approvalReportHash,policyHash:'c'.repeat(64),policyRevision:1,uploadPolicyRevision:1,bundleRevision:1,objectRevision:1,
 declaredType:'image/png',byteCount:1024,sha256:'d'.repeat(64),key:`atlas-ownership-proof/v2/${bundleId}/${objectId}`,expiresAt:'2026-10-22T01:00:00.000Z'};return{...p,planHash:hash(p)};}
export function observation(p){return{schema:'atlas-ownership-proof-object-observation-v2',planHash:p.planHash,object:{key:p.key,versionId:'v1',etag:'"etag"'},sha256:p.sha256,byteCount:p.byteCount,contentType:'application/octet-stream',
 validation:{recipe:OWNERSHIP_PROOF_VALIDATORS.recipe,decoderVersion:OWNERSHIP_PROOF_VALIDATORS.versions[p.declaredType],mime:p.declaredType,width:32,height:32,pixels:1024,originalSha256:p.sha256,originalByteCount:p.byteCount}};}
test('disabled defaults and closed reservation metadata admit practical bounded originals, no PDF or byte payload',()=>{
 assert.equal(OWNERSHIP_PROOF_DEFAULTS.enabled,false);assert.equal(OWNERSHIP_PROOF_DEFAULTS.deleteAfterSeconds,null);
 const d={requestId:randomUUID(),certificateNumber:card.certificateNumber,expectedPublishedBinding:card,proofKind:'RECEIPT_PHOTO',files:[{clientFileId:randomUUID(),byteCount:20*1024*1024,sha256:'c'.repeat(64),declaredType:'image/jpeg'}]};
 assert.deepEqual(input('CUSTOMER','reserve_bundle',d),d);
 for(const mutate of [x=>x.accountId=randomUUID(),x=>x.files[0].key='foreign',x=>x.files[0].byteCount++,x=>x.files[0].declaredType='application/pdf',x=>x.files.push({...x.files[0]}),x=>x.expectedPublishedBinding.certificateNumber='ATLAS-000000000000']){const v=structuredClone(d);mutate(v);assert.throws(()=>input('CUSTOMER','reserve_bundle',v),{code:'INVALID_OWNERSHIP_PROOF'});}
 const accessor={...d};Object.defineProperty(accessor,'proofKind',{get(){throw Error('getter executed');}});assert.throws(()=>input('CUSTOMER','reserve_bundle',accessor),{code:'INVALID_OWNERSHIP_PROOF'});
});
test('claim lifecycle action matrix, revisions and no customer review authority',()=>{
 const d={requestId:randomUUID(),claimId:randomUUID(),expectedClaimRevision:1};assert.deepEqual(input('CUSTOMER','withdraw_claim',d),d);
 assert.throws(()=>input('CUSTOMER','review_claim',{}),{code:'OWNERSHIP_LIFECYCLE_ACTION_FORBIDDEN'});
 for(const v of [0,-1,1.5,2147483647,'1'])assert.throws(()=>input('CUSTOMER','withdraw_claim',{...d,expectedClaimRevision:v}));
 assert.throws(()=>input('REVIEWER','review_claim',{...d,expectedOwnershipRevision:0,decision:'VERIFY',reasonCode:'ACCEPTED',decisionReference:'https://example.test\nheader'}));
});
test('canonical plan hash binds all source/policy/account/object fields and exact derived key',()=>{
 assert.equal(canonical({b:[1,{z:'x',a:null}],a:true}),'{'+'"a":true,"b":[1,{"a":null,"z":"x"}]}');
 const p=objectPlan();assert.deepEqual(ownershipProofObjectPlan(p),p);
 for(const mutate of [x=>x.accountId=randomUUID(),x=>x.approvalReportHash='e'.repeat(64),x=>x.policyRevision++,x=>x.key+='x',x=>x.bundleRevision=2,x=>x.planHash='f'.repeat(64),x=>x.url='https://private.invalid']){const v=structuredClone(p);mutate(v);assert.throws(()=>ownershipProofObjectPlan(v));}
});
test('retained observation pins exact bytes, object version, decoder recipe and dimensions',()=>{
 const p=objectPlan(),v=observation(p);assert.deepEqual(ownershipProofObjectObservation(v,p),v);
 for(const mutate of [x=>x.sha256='e'.repeat(64),x=>x.object.key+='x',x=>x.byteCount++,x=>x.validation.originalSha256='f'.repeat(64),x=>x.validation.width=1,x=>x.validation.pixels++,x=>x.validation.decoderVersion='unknown',x=>x.validation.mime='image/jpeg',x=>x.contentType='image/png',x=>x.validation.url='https://elsewhere.test']){const q=structuredClone(v);mutate(q);assert.throws(()=>ownershipProofObjectObservation(q,p));}
});
test('reservation recovery is account scoped and request bound, projected metadata strips storage authority',()=>{
 const p=objectPlan(),requestId=randomUUID(),v={actorId:p.accountId,observedAt:'2026-10-22T00:00:00Z',bundle:{bundleId:p.bundleId,requestId,card,proofKind:'RECEIPT_PHOTO',policyRevision:1,uploadPolicyRevision:1,
 expiresAt:p.expiresAt,usableUntil:'2026-10-23T00:00:00Z',deleteAfter:'2026-10-24T00:00:00Z',consumed:false,key:p.key,files:[{objectId:p.objectId,clientFileId:randomUUID(),sha256:p.sha256,byteCount:p.byteCount,declaredType:p.declaredType,state:'RETAINED',versionId:'private'}]}};
 const r=projectOwnershipLifecycle('CUSTOMER','recover_request',v,{requestId});assert.equal(r.schema,'atlas-ownership-proof-bundle-v2');assert.equal(r.bundle.allRetained,true);assert.doesNotMatch(JSON.stringify(r),/versionId|atlas-ownership-proof\/|"key"/);
 assert.throws(()=>projectOwnershipLifecycle('CUSTOMER','recover_request',v,{requestId:randomUUID()}),{code:'OWNERSHIP_LIFECYCLE_RESPONSE_INVALID'});
});
test('historical claim status separates withdrawal, missing source, current title and competing identities',()=>{
 const claimId=randomUUID(),v={actorId:randomUUID(),observedAt:'2026-10-22T00:00:00Z',claim:{claimId,cardId:card.cardId,card:null,claimRevision:2,state:'WITHDRAWN',bundleId:null,blockedReasons:['POLICY_UNAVAILABLE','CARD_UNAVAILABLE'],currentlyOwnedByYou:false,ownerAccountId:randomUUID()}};
 const r=projectOwnershipLifecycle('CUSTOMER','read_claim',v,{claimId});assert.equal(r.claim.state,'WITHDRAWN');assert.equal(r.claim.card,null);assert.equal(r.claim.currentlyOwnedByYou,false);assert(!JSON.stringify(r).includes('ownerAccountId'));
 assert.throws(()=>projectOwnershipLifecycle('CUSTOMER','read_claim',{...v,claim:{...v.claim,card:{...card,cardId:randomUUID()}}},{claimId}));
});
test('immutable v1 source preserved and successor embeds the exact old branch plus a pinned guard',async()=>{
 const old=await readFile(new URL('../sql/card-ownership-evidence-proposal.sql',import.meta.url),'utf8');assert.equal(createHash('sha256').update(old).digest('hex'),'ba9171cae508f2561ed6c71d9231fdcc885c67f9980d6c771f92d275ecf1aa1d');
 const next=await readFile(new URL('../sql/card-ownership-lifecycle-successor-proposal.sql',import.meta.url),'utf8');
 const branch=old.slice(old.indexOf(' DELETE FROM atlas_ownership_evidence.event_guard'),old.indexOf('CREATE TRIGGER evidence_gateway')).trim();assert(next.includes(branch));
 assert.match(next,/OWNERSHIP_V1_GUARD_SOURCE_CHANGED/);assert.match(next,/OWNERSHIP_LIFECYCLE_GATEWAY_REQUIRED/);assert.doesNotMatch(next,/\bGRANT\s+EXECUTE|\bALTER\s+TABLE\s+atlas_ownership\.event/i);
});
