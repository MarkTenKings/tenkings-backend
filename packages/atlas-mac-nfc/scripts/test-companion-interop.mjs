import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createStationSigner, stationCanonical, stationProfileHash, stationHash, verifyStationSignature } from '../../atlas-finishing/src/station-protocol.mjs';
import { encodeApprovedNdef } from '../../atlas-finishing/src/mac-nfc.mjs';
import { samplePlan } from '../../atlas-finishing/test/manual-fixture.mjs';

// Executable Node→Swift interop; only cold capabilities and unqualified signed
// arms are sent. No presence/open-success/key-info/init-key operation is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = join(root, '.build/debug/atlas-mac-nfc-companion');
const temp = await mkdtemp(join(tmpdir(), 'atlas-companion-interop-'));
try {
  await chmod(temp, 0o700);
  const hostKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); // CPU fixture, not a station key.
  const host = createStationSigner({ keyId: 'fixture-host', privateKey: hostKey.privateKey.export({ type:'pkcs8',format:'pem' }) });
  const profile = { id:'atlas-mac-f8215-production-v1', qualificationHash:'e'.repeat(64), firstUserPage:4,lastUserPage:63 };
  profile.profileHash = stationProfileHash(profile);
  const config = { version:'atlas-mac-companion-config-v1', stationId:'fixture-station',enrollmentId:'11111111-1111-4111-8111-111111111111',
    keyId:'fixture-key',hostKeyId:host.keyId,hostPublicKeySpki:host.publicKeySpki,protectionEvidenceHash:'d'.repeat(64),profile };
  const path = join(temp, 'config.json'); await writeFile(path, stationCanonical(config), { mode:0o600 });
  const cap = spawnSync(executable,['capabilities'],{encoding:'utf8',timeout:10000}); assert.equal(cap.status,0); const capabilities=JSON.parse(cap.stdout);
  assert.equal(capabilities.protocol,'atlas-mac-companion-rpc-v1'); assert.equal(capabilities.qualifiedProfileAvailable,false);
  assert.equal(capabilities.keyCreationAvailable,true); assert.equal(capabilities.productionReady,false);
  const checked=spawnSync(executable,['validate-configuration','--configuration',path],{encoding:'utf8',timeout:10000});
  assert.equal(checked.status,0); assert.deepEqual(JSON.parse(checked.stdout),{configurationValid:true});
  const badPath=join(temp,'bad-config.json'); await writeFile(badPath,stationCanonical({...config,profile:{...profile,profileHash:'0'.repeat(64)}}),{mode:0o600});
  const rejected=spawnSync(executable,['validate-configuration','--configuration',badPath],{encoding:'utf8',timeout:10000});
  assert.equal(rejected.status,64); assert.equal(JSON.parse(rejected.stdout).error,'COMPANION_INPUT_INVALID');
  const plan=samplePlan(), now=Date.now();
  const claims = {version:'atlas-mac-nfc-arm-v1',origin:'https://atlasgrading.com',stationId:config.stationId,enrollmentId:config.enrollmentId,keyId:config.keyId,
    intentId:plan.nfc.intentId,planHash:plan.planHash,profileHash:profile.profileHash,qualificationHash:profile.qualificationHash,
    activationId:'fixture-activation',cardId:plan.binding.cardId,approvalActionId:plan.binding.approvalActionId,
    publicHash:plan.binding.publicHash,reportHash:plan.binding.reportHash,approvalVersion:plan.binding.approvalVersion,reportNumber:plan.binding.reportNumber,
    url:plan.nfc.url,ndefHash:stationHash(encodeApprovedNdef(plan)),
    firstUserPage:4,lastUserPage:63,nonce:'x'.repeat(43),issuedAt:now-1000,expiresAt:now+60000};
  const run = requests => {
    const result=spawnSync(executable,['serve','--configuration',path],{input:requests.map(value=>JSON.stringify(value)).join('\n')+'\n',encoding:'utf8',timeout:10000});
    assert.equal(result.status,0, result.stdout+result.stderr); assert.equal(result.stderr,''); return result.stdout.trim().split('\n').map(value=>JSON.parse(value));
  };
  const envelope=await host.signClaims(claims);
  const results=run([{id:'arm',op:'arm',envelope},{id:'open',op:'open'},{id:'sign',op:'sign-receipt',receipt:{}},{id:'arbitrary',op:'transmit',apdu:'ff000000'}]);
  assert.equal(results[0].ok,true,JSON.stringify(results[0])); assert.equal(results[0].result.state,'VERIFIED_UNQUALIFIED'); assert.equal(results[0].result.authorizationHash,stationHash(stationCanonical(claims)));
  assert.equal(results[1].error,'COMPANION_PROFILE_UNQUALIFIED'); assert.equal(results[2].ok,false); assert.equal(results[3].ok,false);
  for(const mutation of [{url:'https://example.com/'},{ndefHash:'0'.repeat(64)},{expiresAt:now-500},{profileHash:'0'.repeat(64)}]) {
    assert.equal(run([{id:'invalid',op:'arm',envelope:await host.signClaims({...claims,...mutation})}])[0].ok,false);
  }
  const tampered={...envelope,payload:Buffer.from(stationCanonical({...claims,url:'https://example.com/'})).toString('base64url')};
  assert.equal(run([{id:'forged',op:'arm',envelope:tampered}])[0].ok,false);
  // Explicit key setup parser rejects before any key provider call.
  const invalidInit=spawnSync(executable,['init-key','--configuration',join(temp,'missing.json')],{encoding:'utf8',timeout:10000});
  assert.equal(invalidInit.status,64); assert.equal(JSON.parse(invalidInit.stdout).error,'COMPANION_CONFIG_UNSAFE');
  const oversized=spawnSync(executable,['serve','--configuration',path],{input:'x'.repeat(32769)+'\n',encoding:'utf8',timeout:10000});
  assert.equal(oversized.status,64); assert.equal(JSON.parse(oversized.stdout).error,'COMPANION_INPUT_TOO_LARGE');
  // Recovery travels through the same Swift Runtime, linked in a separate
  // explicitly fake-reader/CPU-key executable; never a shipping bypass flag.
  const stationKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const receipt={version:'atlas-mac-nfc-result-v1',intentId:claims.intentId,planHash:claims.planHash,profileHash:claims.profileHash,
    stationId:claims.stationId,enrollmentId:claims.enrollmentId,keyId:claims.keyId,authorizationHash:stationHash(stationCanonical(claims)),
    nonce:claims.nonce,ndefHash:claims.ndefHash,readbackVerified:true,lockVerified:true};
  const signature=sign('sha256',Buffer.from(stationCanonical(receipt)),{key:stationKey.privateKey,dsaEncoding:'der'}).toString('base64url');
  const ack={version:'atlas-mac-nfc-ack-v1',kind:'WRITE',intentId:claims.intentId,receiptHash:stationHash(stationCanonical(receipt)),
    enrollmentId:claims.enrollmentId,stationId:claims.stationId,planHash:claims.planHash,authorizationHash:receipt.authorizationHash,committed:true,recordedAt:now};
  const removal={version:'atlas-mac-nfc-removal-v1',stationId:claims.stationId,enrollmentId:claims.enrollmentId,keyId:claims.keyId,
    intentId:claims.intentId,planHash:claims.planHash,authorizationHash:receipt.authorizationHash,nonce:claims.nonce,receiptHash:ack.receiptHash,removalObserved:true};
  const restoreRequests=[{id:'restore',op:'restore-receipt',envelope,receipt,signature},{id:'open',op:'open'},
    {id:'early-removal',op:'sign-removal',receipt:removal},{id:'ack',op:'accept-ack',envelope:await host.signClaims(ack)},
    {id:'empty',op:'observe-empty'},{id:'removal',op:'sign-removal',receipt:removal}];
  const restored=spawnSync(join(root,'.build/debug/atlas-mac-nfc-companion-tests'),['--interop-fixture',path],{
    input:restoreRequests.map(value=>JSON.stringify(value)).join('\n')+'\n',encoding:'utf8',timeout:10000,
    env:{...process.env,ATLAS_TEST_CPU_KEY:stationKey.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')}});
  assert.equal(restored.status,0,restored.stdout+restored.stderr); const restoredReplies=restored.stdout.trim().split('\n').map(value=>JSON.parse(value));
  assert.equal(restoredReplies[0].result.restored,true); assert.equal(restoredReplies[1].error,'COMPANION_RECOVERY_READ_ONLY');
  assert.equal(restoredReplies[2].error,'COMPANION_REMOVAL_ACK_REQUIRED'); assert.equal(restoredReplies[3].result.acknowledged,true);
  verifyStationSignature(stationKey.publicKey.export({format:'der',type:'spki'}).toString('base64'),removal,restoredReplies[5].result.signature);
  console.log(JSON.stringify({test:'node_native_signed_protocol_interop',ok:true,scenarios:19,hardwareCalls:0,keychainCalls:0}));
} finally { await rm(temp,{recursive:true,force:true}); }
