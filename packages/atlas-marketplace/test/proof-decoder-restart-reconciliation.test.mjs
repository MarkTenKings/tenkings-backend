import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJSON,hash} from '../src/contract.mjs';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';
import {reviewProofDecoderRecoverySnapshot,classifyProofDecoderRecoveryResource} from '../src/proof-decoder-recovery-record.mjs';
import {openProofDecoderEnrolledTargetRegistry,reconcileProofDecoderRestart,assertProofDecoderRecoveryRegistryOpen,assertProofDecoderRecoveryRegistryLive,bindProofDecoderRecoveryRegistry} from '../src/proof-decoder-restart-reconciliation.mjs';
import {assertProofDecoderOwnedEngineCleanupReceipt} from '../src/proof-decoder-engine-owned-cleanup.mjs';

const plan=createProofDecoderLaunchPlan({enabled:true,profile:syntheticDecoderProfile()});
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
function fixture(intent=false){
  const binding={schema:'atlas-proof-decoder-target-ledger-binding-v1',bootId:'e9c8b63a-b7c6-4dce-bb9b-22402fce6e11',epoch:'TEST_ONLY',profileHash:plan.profileHash,limitsHash:plan.limitsHash,image:plan.profile.image,parentBindingHash:'e'.repeat(64)};
  const manifest={schema:'atlas-proof-decoder-target-registry-v1',registryId:ids[0],tokenHash:'f'.repeat(64),binding,bindingHash:hash(binding),uid:0,directory:{device:'1',inode:'2'},database:{device:'1',inode:'3'}};
  const identity={registryId:ids[0],jobId:ids[1],requestId:ids[2],ownerNonce:'d'.repeat(64),epoch:binding.epoch,profileHash:plan.profileHash,image:plan.profile.image,name:`atlas-proof-${ids[0]}-${ids[1]}`,containerId:null};
  const row={identity,requestPlan:{byteCount:1,sha256:'a'.repeat(64),declaredType:'image/png'},bindingHash:manifest.bindingHash,phase:'RESERVED',revision:0,createdAtNs:'1',deadlineAtNs:'1000000001',barrierId:null,barrierAtNs:null,effects:[],engineExit:null,cleanup:null};
  const events=[{job_id:ids[1],revision:0,previous_hash:null,record_hash:hash(row),event:canonicalJSON({type:'RESERVE',atNs:'1',operationId:null})}];
  if(intent){row.phase='CREATE_INTENT';row.revision=1;row.effects.push({operationId:ids[3],operation:'CREATE',requestHash:'b'.repeat(64),intentAtNs:'2',intentRevision:1,receipt:null});events.push({job_id:ids[1],revision:1,previous_hash:events[0].record_hash,record_hash:hash(row),event:canonicalJSON({type:'EFFECT_INTENT',atNs:'2',operationId:ids[3]})});}
  return {plan,manifest,state:{poisoned:false,reason:null,barrierClosed:false},jobs:[{id:ids[1],revision:row.revision,record:canonicalJSON(row)}],events};
}
function mutateRow(input,change){const row=JSON.parse(input.jobs[0].record);change(row);input.jobs[0].record=canonicalJSON(row);input.events.at(-1).record_hash=hash(row);return input;}

test('restart factories are default off; options and private enrollment refuse forgery without invoking getters',async()=>{
  assert.equal(openProofDecoderEnrolledTargetRegistry(),null);assert.equal(await reconcileProofDecoderRestart(),null);
  let called=false;const accessor={get enabled(){called=true;return true;}};
  assert.throws(()=>openProofDecoderEnrolledTargetRegistry(accessor));await assert.rejects(reconcileProofDecoderRestart(accessor));assert.equal(called,false);
  assert.throws(()=>openProofDecoderEnrolledTargetRegistry({enabled:false,directory:'/tmp/alternate'}));
  assert.throws(()=>assertProofDecoderRecoveryRegistryOpen({}, {plan,controller:{},directory:'/var/lib/atlas-r2-decoder-recovery/ledger',epoch:'TEST'}),{code:'DECODER_RECOVERY_ENROLLMENT_REQUIRED'});
  assert.throws(()=>assertProofDecoderRecoveryRegistryLive({},{}),{code:'DECODER_RECOVERY_ENROLLMENT_REQUIRED'});
  assert.throws(()=>bindProofDecoderRecoveryRegistry({},{}),{code:'DECODER_RECOVERY_ENROLLMENT_REQUIRED'});
  assert.throws(()=>assertProofDecoderRecoveryRegistryOpen({}, {get plan(){called=true;return plan;},controller:{},directory:'x',epoch:'x'}));assert.equal(called,false);
});

test('validated historical reservation and unresolved CREATE remain immutable holds without live receipt authority',()=>{
  for(const pending of [false,true]){
    const input=fixture(pending),review=reviewProofDecoderRecoverySnapshot(input);assert.deepEqual(review.heldJobs,[ids[1]]);assert.equal(review.historicalDataOnly,true);assert.equal(review.executionAllowed,false);
    assert.equal(review.rows[0].phase,pending?'CREATE_INTENT':'RESERVED');assert.ok(Object.isFrozen(review.rows[0].identity));
    input.manifest.binding.epoch='CHANGED';assert.equal(review.manifest.binding.epoch,'TEST_ONLY');
    assert.throws(()=>assertProofDecoderOwnedEngineCleanupReceipt(review,{identity:review.rows[0].identity,bindingHash:review.manifest.bindingHash,barrierId:null}),{code:'ENGINE_TARGET_CLEANUP_RECEIPT_REQUIRED'});
  }
});

test('historical validator refuses changed revision, identity, noncanonical bytes and malformed ownership',()=>{
  const cases=[x=>{x.jobs[0].revision++;},x=>{x.jobs[0].id=ids[3];},x=>{x.jobs[0].record+=' ';},x=>{x.manifest.bindingHash='a'.repeat(64);},x=>{x.jobs.push({...x.jobs[0]});},x=>mutateRow(x,row=>{row.identity.containerId='a'.repeat(64);}),x=>mutateRow(x,row=>{row.deadlineAtNs='1';})];
  for(const change of cases){const input=fixture(true);change(input);assert.throws(()=>reviewProofDecoderRecoverySnapshot(input));}
});

test('history chain, intent identity, event type and poison barrier must agree with the held row',()=>{
  const cases=[x=>{x.events[1].previous_hash='c'.repeat(64);},x=>{x.events[1].record_hash='c'.repeat(64);},x=>{x.events[1].event=canonicalJSON({type:'EFFECT_OBSERVED',atNs:'2',operationId:ids[3]});},x=>{x.events[1].event=canonicalJSON({type:'EFFECT_INTENT',atNs:'2',operationId:ids[2]});},x=>{x.events[0].job_id=ids[3];},x=>{x.state.poisoned=true;x.state.reason='UNKNOWN';},x=>{x.state.barrierClosed=true;}];
  for(const change of cases){const input=fixture(true);change(input);assert.throws(()=>reviewProofDecoderRecoverySnapshot(input));}
  const poisoned=fixture(true);poisoned.state={poisoned:true,reason:'UNKNOWN',barrierClosed:true};assert.equal(reviewProofDecoderRecoverySnapshot(poisoned).state.poisoned,true);
});

test('nested array/record accessors are rejected before invocation',()=>{
  let called=false;const input=fixture();Object.defineProperty(input.jobs,'0',{enumerable:true,get(){called=true;return {};}});assert.throws(()=>reviewProofDecoderRecoverySnapshot(input));assert.equal(called,false);
  const input2=fixture();Object.defineProperty(input2.jobs[0],'record',{enumerable:true,get(){called=true;return '';}});assert.throws(()=>reviewProofDecoderRecoverySnapshot(input2));assert.equal(called,false);
});

test('resource policy never retries either REMOVE intent, clears unknown, or treats 404 as capacity',()=>{
  const base={phase:'RUNNING',hasCreateIntent:true,hasOriginalRemoveIntent:false,hasRecoveryRemoveIntent:false,observation:'PRESENT'};
  assert.equal(classifyProofDecoderRecoveryResource(base).action,'ONE_OWNED_DELETE_CANDIDATE');
  for(const key of ['hasOriginalRemoveIntent','hasRecoveryRemoveIntent'])assert.equal(classifyProofDecoderRecoveryResource({...base,[key]:true}).action,'LOOKUP_ONLY_HOLD');
  assert.equal(classifyProofDecoderRecoveryResource({...base,phase:'FINALIZED'}).action,'CONTRADICTION_HOLD');
  for(const phase of ['CREATE_INTENT','START_INTENT','RUNNING','CLEANUP','FINALIZED']){
    const result=classifyProofDecoderRecoveryResource({...base,phase,observation:'ABSENT'});assert.equal(result.action,'ABSENCE_HOLD');assert.equal(result.capacityReleased,false);assert.equal(result.originalOutcomeChanged,false);assert.equal(result.executionAllowed,false);
  }
  assert.equal(classifyProofDecoderRecoveryResource({...base,phase:'RESERVED',hasCreateIntent:false,observation:'UNOBSERVED'}).action,'NO_ENGINE_EFFECT_HOLD');
  assert.throws(()=>classifyProofDecoderRecoveryResource({...base,force:true}));
});
