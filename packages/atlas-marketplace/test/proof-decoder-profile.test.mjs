import test from 'node:test';
import assert from 'node:assert/strict';
import {createProofDecoderLaunchPlan,assertProofDecoderLaunchPlan,PROOF_DECODER_IMAGE_LAYOUT} from '../src/proof-decoder-profile.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';
import {assertProofImageValidator} from '../src/proof-image.mjs';

const make=profile=>createProofDecoderLaunchPlan({enabled:true,profile});
test('source plan defaults off and requires explicit complete target expectations',()=>{
  assert.equal(createProofDecoderLaunchPlan(),null);assert.equal(createProofDecoderLaunchPlan({enabled:false}),null);
  for(const options of [null,true,1,'enabled',[]])assert.throws(()=>createProofDecoderLaunchPlan(options),{code:'DECODER_CONTRACT_INVALID'});
  assert.throws(()=>createProofDecoderLaunchPlan({enabled:null}),{code:'DECODER_PROFILE_INVALID'});
  for(const value of [true,1,'true'])assert.throws(()=>createProofDecoderLaunchPlan({enabled:value}),{code:value===true?'DECODER_CONTRACT_INVALID':'DECODER_PROFILE_INVALID'});
  for(const key of Object.keys(syntheticDecoderProfile())){const profile=syntheticDecoderProfile();delete profile[key];assert.throws(()=>make(profile));}
});
test('fixed token plan is deeply immutable, detached and never grants execution',()=>{
  const profile=syntheticDecoderProfile(),plan=make(profile),args=plan.createArguments;
  assert.equal(plan.status,'UNQUALIFIED');assert.equal(plan.executionAllowed,false);assert.equal(args[0],'create');
  for(const flag of ['--pull=never','--read-only','--network=none','--ipc=private','--cgroupns=private','--cap-drop=ALL','--security-opt=no-new-privileges=true','--restart=no','--log-driver=none','--ulimit=core=0:0'])assert.ok(args.includes(flag),flag);
  assert.deepEqual(args.slice(-3),[profile.image,'--max-old-space-size=128',PROOF_DECODER_IMAGE_LAYOUT.worker]);
  assert.ok(args.includes('--entrypoint='+PROOF_DECODER_IMAGE_LAYOUT.node));
  assert.equal(args.filter(value=>value.startsWith('--env=')).length,5);
  assert.ok(!args.some(value=>/^--(?:mount|volume|privileged|publish|device|cap-add|env-file|use-api-socket)(?:=|$)/.test(value)));
  assert.throws(()=>args.push('bad'),TypeError);assert.throws(()=>{plan.profile.resources.memoryBytes=1;},TypeError);
  profile.uid=0;profile.resources.memoryBytes=1;assert.equal(plan.profile.uid,12345);assert.equal(plan.profile.resources.memoryBytes,268435456);
  assert.deepEqual(assertProofDecoderLaunchPlan(JSON.parse(JSON.stringify(plan))),plan);
  assert.throws(()=>assertProofImageValidator(plan),{code:'PROOF_DECODER_UNAVAILABLE'});
});
test('caller commands, paths, mounts, secrets, tags and unconfined profiles refuse',()=>{
  for(const key of ['command','entrypoint','arguments','mounts','environment','dockerEndpoint','qualified','executionAllowed']){
    const profile=syntheticDecoderProfile();profile[key]='anything';assert.throws(()=>make(profile),{code:'DECODER_CONTRACT_INVALID'});
  }
  for(const image of ['decoder:latest','synthetic.invalid/decoder:latest@sha256:'+'a'.repeat(64),'--privileged','https://synthetic.invalid/decoder@sha256:'+'a'.repeat(64),'user:secret@synthetic.invalid/decoder@sha256:'+'a'.repeat(64),'synthetic.invalid/decoder@sha256:'+'A'.repeat(64)])assert.throws(()=>make({...syntheticDecoderProfile(),image}),{code:'DECODER_PROFILE_INVALID'});
  for(const path of ['/profile.json --privileged','/safe/../profile.json','relative.json','/safe/$(touch-secret).json','/safe/profile.json\n']){const profile=syntheticDecoderProfile();profile.seccomp.path=path;assert.throws(()=>make(profile));}
  for(const name of ['unconfined','disable','docker-default','safe,unconfined']){const profile=syntheticDecoderProfile();profile.mac.name=name;assert.throws(()=>make(profile));}
});
test('missing, unlimited, root and inconsistent resource expectations refuse',()=>{
  for(const [key,value] of [['uid',0],['gid',0],['uid',-1],['gid',2147483648],['platform','darwin/arm64'],['nodeVersion','22.15.0']])assert.throws(()=>make({...syntheticDecoderProfile(),[key]:value}));
  for(const key of Object.keys(syntheticDecoderProfile().resources))for(const value of [0,-1,Infinity,1.5,'unlimited']){const profile=syntheticDecoderProfile();profile.resources[key]=value;assert.throws(()=>make(profile));}
  for(const key of Object.keys(syntheticDecoderProfile().limits)){const profile=syntheticDecoderProfile();profile.limits[key]++;assert.throws(()=>make(profile));}
  const largeTmp=syntheticDecoderProfile();largeTmp.resources.tmpfsBytes=largeTmp.resources.memoryBytes+1;assert.throws(()=>make(largeTmp));
  for(const path of ['/decoder.sock','/unsafe/../decoder.sock','/unsafe/decoder.sock\n']){const profile=syntheticDecoderProfile();profile.ipc.socketPath=path;assert.throws(()=>make(profile));}
  const sharedUid=syntheticDecoderProfile();sharedUid.ipc.clientUid=sharedUid.ipc.supervisorUid;assert.throws(()=>make(sharedUid));
  const selinux=syntheticDecoderProfile();selinux.mac={kind:'selinux',name:'synthetic_decoder_t'};assert.ok(make(selinux).createArguments.includes('--security-opt=label=type:synthetic_decoder_t'));
});
test('accessors, exotic objects and altered plans cannot cross the pure contract',()=>{
  let reads=0;const getter=syntheticDecoderProfile();Object.defineProperty(getter,'image',{enumerable:true,get(){reads++;return 'bad';}});assert.throws(()=>make(getter));assert.equal(reads,0);
  const hidden=syntheticDecoderProfile();Object.defineProperty(hidden,'hidden',{value:'secret'});assert.throws(()=>make(hidden));
  const symbol=syntheticDecoderProfile();symbol[Symbol('hidden')]='secret';assert.throws(()=>make(symbol));
  const exotic=Object.assign(Object.create({}),syntheticDecoderProfile());assert.throws(()=>make(exotic));
  const cycle=syntheticDecoderProfile();cycle.extra=cycle;assert.throws(()=>make(cycle));
  const plan=JSON.parse(JSON.stringify(make(syntheticDecoderProfile())));plan.createArguments.push('--privileged');assert.throws(()=>assertProofDecoderLaunchPlan(plan),{code:'DECODER_LAUNCH_PLAN_CHANGED'});
  const claimed=JSON.parse(JSON.stringify(make(syntheticDecoderProfile())));claimed.executionAllowed=true;assert.throws(()=>assertProofDecoderLaunchPlan(claimed),{code:'DECODER_LAUNCH_PLAN_CHANGED'});
});
