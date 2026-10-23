import test from 'node:test';
import assert from 'node:assert/strict';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {createProofDecoderTargetBrokerClient} from '../src/proof-decoder-target-broker.mjs';
import {TARGET_BROKER_SOCKET} from '../src/proof-decoder-target-broker-protocol.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';

test('prepared API remains default off and rejects added authority/handle constructor options',()=>{
  assert.equal(createProofDecoderTargetBrokerClient(),null);
  for(const field of ['prepareRequest','submitPrepared','lookupDisposition','qualified','requestId'])assert.throws(()=>createProofDecoderTargetBrokerClient({enabled:false,[field]:true}));
  let calls=0;assert.throws(()=>createProofDecoderTargetBrokerClient({get enabled(){calls++;return true;}}));assert.equal(calls,0);
});
test('no prepared handle or disposition client can be constructed from a shaped native observer',()=>{
  const profile=syntheticDecoderProfile();profile.limits.maxConcurrent=1;profile.ipc={...profile.ipc,socketPath:TARGET_BROKER_SOCKET,supervisorUid:0,supervisorGid:0};
  const plan=createProofDecoderLaunchPlan({enabled:true,profile});let calls=0;
  const observer={boottimeNanoseconds(){calls++;return 1n;},capture(){calls++;throw new Error('not native');}};
  assert.throws(()=>createProofDecoderTargetBrokerClient({enabled:true,plan,observer,expectedBootId:'11111111-1111-4111-8111-111111111111',expectedEpoch:'PREPARED_REFUSAL',expectedBindingHash:'a'.repeat(64)}),{code:'DECODER_LINUX_OBSERVER_REQUIRED'});
  assert.equal(calls,0);
});
