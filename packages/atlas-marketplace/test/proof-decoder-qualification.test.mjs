import test from 'node:test';
import assert from 'node:assert/strict';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {assessProofDecoderTargetEvidence,PROOF_DECODER_REQUIRED_CASES} from '../src/proof-decoder-qualification.mjs';
import {syntheticDecoderProfile,syntheticDecoderEvidence} from './proof-decoder-profile-fixtures.mjs';
import {assertProofImageValidator} from '../src/proof-image.mjs';

const input=()=>{const plan=createProofDecoderLaunchPlan({enabled:true,profile:syntheticDecoderProfile()});return {plan,evidence:syntheticDecoderEvidence(plan),now:1001};};
test('all claimed adversarial cases complete only an UNVERIFIED document',()=>{
  const data=input(),assessment=assessProofDecoderTargetEvidence(data);
  assert.equal(assessment.status,'UNVERIFIED');assert.equal(assessment.runtimeQualified,false);assert.equal(assessment.contractComplete,true);assert.deepEqual(assessment.failedCases,[]);assert.deepEqual(assessment.unresolvedCases,[]);
  assert.throws(()=>{assessment.runtimeQualified=true;},TypeError);data.evidence.cases[0].outcome='FAIL';assert.equal(assessment.contractComplete,true);
  assert.throws(()=>assertProofImageValidator(assessment),{code:'PROOF_DECODER_UNAVAILABLE'});
});
test('failed or unrun adversarial cases remain explicit; missing and duplicate cases refuse',()=>{
  const data=input();data.evidence.cases[0].outcome='FAIL';data.evidence.cases[1]={id:data.evidence.cases[1].id,outcome:'NOT_RUN',startedAt:null,finishedAt:null,observationSha256:null};
  const result=assessProofDecoderTargetEvidence(data);assert.equal(result.contractComplete,false);assert.deepEqual(result.failedCases,['VALID_PNG']);assert.deepEqual(result.unresolvedCases,['VALID_JPEG']);assert.equal(result.status,'UNVERIFIED');
  for(const mutate of [e=>e.cases.pop(),e=>{e.cases[1]=e.cases[0];},e=>{e.cases[0].id='UNKNOWN';},e=>{e.cases[0].outcome=true;},e=>{e.cases[0].observationSha256=null;}]){const next=input();mutate(next.evidence);assert.throws(()=>assessProofDecoderTargetEvidence(next));}
  for(const required of ['SUPERVISOR_DEATH_WATCHDOG','CANCEL_IGNORED_TERM_AND_DESCENDANTS','UNKNOWN_CLEANUP_QUARANTINE','RESTART_RECONCILIATION','IPC_PEER_AND_DIRECTORY_INTEGRITY'])assert.ok(PROOF_DECODER_REQUIRED_CASES.includes(required));
});
test('profile, artifact, epoch shape, clock and target mismatches refuse',()=>{
  for(const mutate of [e=>{e.profileHash='0'.repeat(64);},e=>{e.limitsHash='0'.repeat(64);},e=>{e.targetRef='OTHER';},e=>{e.artifactHashes.watchdog='0'.repeat(64);},e=>{e.serviceEpoch='';},e=>{e.issuedAt=1002;},e=>{e.expiresAt=1001;},e=>{e.cases[0].finishedAt=1001;},e=>{e.cases[0].startedAt=1000;},e=>{e.qualified=true;}]){const next=input();mutate(next.evidence);assert.throws(()=>assessProofDecoderTargetEvidence(next));}
  const noClock=input();delete noClock.now;assert.throws(()=>assessProofDecoderTargetEvidence(noClock));
});
test('observed weaker containment and absent independent cleanup never validate',()=>{
  const mutations=[o=>{o.uid=0;},o=>{o.rootReadonly=false;},o=>{o.capEffective='0000000000000001';},o=>{o.noNewPrivileges=false;},o=>{o.seccompMode=0;},o=>{o.mac.enforcing=false;},o=>{o.namespaces.pid='host';},o=>{o.networkInterfaces.push('eth0');},o=>{o.publishedPorts.push(8080);},o=>{o.operatorAddedMounts.push('/proof');},o=>{o.imageDeclaredVolumes.push('/data');},o=>{o.imageEnvironmentNames.push('SECRET');},o=>{o.applicationSecretsPresent=true;},o=>{o.dockerSocketPresent=true;},o=>{o.resources.memorySwapMaxBytes=1024;},o=>{o.resources.memoryMaxBytes++;},o=>{o.resources.cgroupKillAvailable=false;},o=>{o.resources.tmpfsMountFlags=['nosuid'];},o=>{o.supervision.independentWatchdog=false;},o=>{o.supervision.restartReconcilesOwned=false;},o=>{o.supervision.appHasDockerAccess=true;},o=>{o.supervision.queueCapacity=1;}];
  for(const mutate of mutations){const next=input();mutate(next.evidence.observed);assert.throws(()=>assessProofDecoderTargetEvidence(next),{code:'DECODER_OBSERVATION_MISMATCH'});}
});
test('IPC identity, permissions, protected paths and corpus bindings are required',()=>{
  for(const [key,value] of [['socketPath','/other/decoder.sock'],['directoryRealPath','/other'],['directoryMode','0770'],['socketMode','0666'],['peerUid',0],['peerGid',0],['symlinksPresent',true],['ancestorsProtected',false],['clientCanReplaceEndpoint',true],['serviceEpoch','OLD'],['socketInode',0],['peerPid',0]]){const next=input();next.evidence.observed.ipc[key]=value;assert.throws(()=>assessProofDecoderTargetEvidence(next));}
  const noCorpus=input();delete noCorpus.evidence.artifactHashes.corpus;assert.throws(()=>assessProofDecoderTargetEvidence(noCorpus));
  const noMountManifest=input();delete noMountManifest.evidence.observed.mountManifestSha256;assert.throws(()=>assessProofDecoderTargetEvidence(noMountManifest));
  const runtimeSecret=input();runtimeSecret.evidence.observed.runtimeEnvironment.SECRET='synthetic';assert.throws(()=>assessProofDecoderTargetEvidence(runtimeSecret));
});
