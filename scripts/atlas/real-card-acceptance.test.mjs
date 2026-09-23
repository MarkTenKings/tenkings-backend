import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectAcceptance, evidenceReader, template } from './real-card-acceptance.mjs';
import { canonical, digest } from '../../packages/atlas-manual-service/src/contract.mjs';
import { descriptorSha256 } from '../../packages/atlas-photo-core/src/index.mjs';

// All positive pipeline data below is explicitly synthetic LOCAL_FIXTURE data.
// No test imports a provider/client, authenticates a user or operates a device.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'atlas-acceptance-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  let sequence = 0;
  const save = async value => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const path = `artifact-${sequence++}.json`; await writeFile(join(root, path), bytes);
    return { path, sha256: digest(bytes), byteCount: bytes.length };
  };
  const read = async ref => JSON.parse(await readFile(join(root, ref.path), 'utf8'));
  const change = async (ref, fn) => { const value = await read(ref); fn(value); return save(value); };
  const at = second => `2026-09-23T12:00:${String(second).padStart(2,'0')}.000Z`;
  const cardId = randomUUID(), actorId = randomUUID(), actionId = randomUUID(), analysisId = randomUUID(), analysisActionId = randomUUID();
  const receipt = await save({ scope: 'FIXTURE', description: 'synthetic test receipt; no physical observation' });
  const manifest = { ...template(), scope: 'FIXTURE', cohortId: 'synthetic-unit-test', target: 1, startedAt: at(1), observedThrough: at(59) };
  manifest.release = await save({ version: 'atlas-acceptance-release-v1', scope: 'FIXTURE', sourceCommit: 'a'.repeat(40),
    nativeImageDigest: `sha256:${'b'.repeat(64)}`, staffDeploymentId: 'dpl_fixture_staff', publicDeploymentId: 'dpl_fixture_public',
    observedAt: at(0), batchEnabled: true, qualificationStatus: 'PASS', receipts: [receipt], migrations: [{name:'20260922210100_batch_grading',sha256:'c'.repeat(64)}] });
  const item = { cardId, specimenId: 'synthetic-one', originals: {}, finishing: {} }; manifest.cards = [item];
  const card = { cardId, pairId: randomUUID(), createdAt: at(4), ready: true, sides: {} }, photos = {}, hashes = {};
  for (const side of ['FRONT','BACK']) {
    const original = await save(Buffer.from(`SYNTHETIC-NOT-A-PHOTO-${side}-${cardId}`)); item.originals[side] = original; hashes[side] = original.sha256;
    const uploadId = randomUUID(), plan = { uploadId, binding: { cardId, pairId: card.pairId, side, version: 1 }, expected: { sha256: original.sha256, byteCount: original.byteCount } };
    const verification = { sha256: original.sha256, byteCount: original.byteCount };
    const photo = { original: { content: { sha256: original.sha256, byteCount: original.byteCount } }, decodedFrame: { raster: { dimensions: { width: 3000,height: 4000 } } }, workingFrame: { raster: { dimensions: {width:3000,height:4000} } } };
    photos[side] = await save(photo);
    card.sides[side] = { version: 1, upload: { uploadId, version: 1, side, plan, verification,
      source: { ref: { ...photos[side], cardId, kind: 'PHOTO_SOURCE' }, photoSourceHash: descriptorSha256({ plan, verification }) } } };
  }
  card.sourceHash = descriptorSha256({cardId, pairId:card.pairId, front:card.sides.FRONT.upload,back:card.sides.BACK.upload});
  item.capture = await save({ version:'atlas-acceptance-capture-v1',scope:'FIXTURE', cardId, specimenId:item.specimenId,observerId:actorId,
    freshNativeOriginals:true,samePhysicalPair:true,distinctPhysicalSpecimen:true,observedAt:at(3),capturedAt:{FRONT:at(2),BACK:at(2)}, originalSha256:hashes,receipts:[receipt] });
  item.intake = await save({ card, photos });
  const request = await save({ model:'gpt-6-astra',reasoning:{effort:'xhigh'} }), rawResponse = Buffer.from(JSON.stringify({id:'resp_fixture',usage:null}));
  const response = await save({ version:1,analysisId,requestHash:request.sha256,sha256:digest(rawResponse),base64:rawResponse.toString('base64') });
  const analysisResult = await save({ proposals:[] });
  const binding = canonical({sourceHash:card.sourceHash}), requestEvidence = canonical({model:'gpt-6-astra',reasoningEffort:'xhigh'});
  item.provider = await save({run:{ id:analysisId,card_id:cardId,action_id:analysisActionId,binding,binding_hash:digest(binding),request_evidence:requestEvidence,evidence_hash:digest(requestEvidence),
    request_hash:request.sha256,state:'DISPATCHED',created_at:at(6),dispatched_at:at(7)},receipts:[{kind:'RESPONSE',analysis_id:analysisId,request_hash:request.sha256,recorded_at:at(10),
      evidence:JSON.stringify({state:'READY',responseHash:digest(rawResponse),responseId:'resp_fixture',responseRef:response,resultRef:analysisResult,usage:null})}],request,response,result:analysisResult });
  const machine = {version:'atlas-machine-provisional-report-v1',authority:'MACHINE_PROPOSAL',certification:null,cardId,sourceHash:card.sourceHash,analysisId,manualRevision:1,
    manualContentHash:'d'.repeat(64),analysisResultHash:digest(canonical([])),findings:[],geometry:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{frame:{originalSha256:hashes[side]}}]))};
  item.machineReport = await save(machine);
  const input = canonical({cardId,sourceHash:card.sourceHash});
  item.job = await save({key:'e'.repeat(64),card_id:cardId,source_hash:card.sourceHash,analysis_action_id:analysisActionId,input,input_hash:digest(input),state:'APPROVED',stage:'REPORT',
    evidence:JSON.stringify({authority:'MACHINE_PROPOSAL',reportHash:item.machineReport.sha256,manualRevision:1,manualContentHash:machine.manualContentHash}),created_at:at(5),updated_at:at(35)});
  const full = { version:'atlas-manual-draft-report-v2',identity:{cardName:'Synthetic'},grade:{overall:{rawGrade:10}},finalGrade:10,finalGradePolicy:'atlas-final-half-point-v1',ruleVersion:'fixture',
    inspection:{method:'HUMAN',front:{inspected:true},back:{inspected:true}} };
  const finalReport = await save(full), snapshot = {version:'atlas-manual-report-snapshot-v2',report:{ref:finalReport,sourceHash:finalReport.sha256},
    ...Object.fromEntries(['identity','grade','finalGrade','finalGradePolicy','ruleVersion'].map(key=>[key,full[key]]))};
  const draft={source:{sourceHash:card.sourceHash}},sourceHash=digest(canonical(draft)),reportText=canonical(snapshot),reportHash=digest(reportText);
  const approval={card_id:cardId,action_id:actionId,actor_id:actorId,source_revision:5,source_hash:sourceHash,report:reportText,report_hash:reportHash,approved_at:at(30)};
  const approveRequest=canonical({actionId,expectedRevision:5,action:{type:'APPROVE_REPORT',reviewed:true,reportHash}});
  const action={card_id:cardId,action_id:actionId,actor_id:actorId,request:approveRequest,request_hash:digest(approveRequest),result:canonical({card:{cardId,contentHash:sourceHash,draft},
    receipt:{actionId,actorId,approval:{reportHash,sourceHash,sourceRevision:5}}})};
  item.human = await save({approval,action,finalReport,decision:{version:'atlas-acceptance-human-decision-v1',scope:'FIXTURE',actorId,cardId,reportHash,approvalActionId:actionId,
    physicalCardInspected:true,bothEvidenceSidesInspected:true,reviewStartedAt:at(20),observedAt:at(31),receipts:[receipt]}});
  const packet={version:'atlas-public-manual-report-v2',publicToken:`ar_${'A'.repeat(24)}`,reportNumber:'ATLAS-012345ABCDEF',approvalVersion:1,reportHash,mode:'LOCAL_FIXTURE',approvedAt:approval.approved_at,report:full};
  const publicHash=digest(JSON.stringify(packet)),publicationManifest=canonical({publicHash,packet:{sourceHash:publicHash,ref:{sha256:publicHash}}});
  item.publication=await save({publication:{card_id:cardId,action_id:actionId,state:'PUBLISHED',mode:'LOCAL_FIXTURE',version:1,public_hash:publicHash,
    manifest:publicationManifest,manifest_hash:digest(publicationManifest),published_at:at(32)},publicResponse:{packet,publicHash},
    requestedUrl:`https://atlasgrading.com/reports/${packet.publicToken}?v=1`,httpStatus:200,fetchedAt:at(33)});
  const run = async () => collectAcceptance(manifest, await evidenceReader(root));
  return {root,save,read,change,manifest,item,run,actorId,at};
}

test('synthetic consistent chain stays FIXTURE; missing finishing never becomes physical acceptance', async t => {
  const f=await fixture(t),result=await f.run();
  assert.equal(result.softwareEvidenceMatched,true,JSON.stringify(result.cards[0].checks));
  assert.equal(result.scope,'FIXTURE');assert.equal(result.realCardAcceptance,'NOT_DETERMINED_BY_COLLECTOR');
  assert.equal(result.cards[0].provider.usage,null);assert.equal(result.cards[0].provider.billingVerified,false);
  assert.equal(result.cards[0].timings.providerDispatchToReceiptMs,3000);
  assert.equal(result.cards[0].checks.find(x=>x.stage==='print').status,'NOT_RUN');
  const text=JSON.stringify(result);assert.equal(text.includes(f.root),false);assert.equal(text.includes('base64'),false);assert.equal(text.includes('Synthetic'),false);
});
for(const [name,key,mutate,stage] of [
  ['fixture release cannot certify real scope','release',v=>{v.scope='REAL_CARD';},'release'],
  ['capture before cohort is historical','capture',v=>{v.capturedAt.FRONT='2026-09-22T12:00:00.000Z';},'freshCaptureAttestation'],
  ['changed photo source hash refuses intake','intake',v=>{v.card.sourceHash='f'.repeat(64);},'originalsAndIntake'],
  ['changed pair fences machine job','job',v=>{v.source_hash='f'.repeat(64);},'batchJob'],
  ['unknown provider outcome is not ready','provider',v=>{v.receipts[0].evidence=JSON.stringify({state:'UNKNOWN'});},'providerEvidence'],
  ['machine cannot acquire human authority','machineReport',v=>{v.authority='HUMAN';},'machineProposal'],
  ['human action must match actual approver','human',v=>{v.decision.actorId=randomUUID();},'humanApproval'],
  ['human review cannot be a machine attestation','human',v=>{v.decision.physicalCardInspected=false;},'humanApproval'],
  ['public grade cannot depart from immutable approval','publication',v=>{v.publicResponse.packet.report.finalGrade=9;v.publicResponse.publicHash=digest(JSON.stringify(v.publicResponse.packet));},'publicVersion'],
  ['public wrong version never matches','publication',v=>{v.requestedUrl=v.requestedUrl.replace('?v=1','?v=2');},'publicVersion'],
])test(name,async t=>{const f=await fixture(t);const holder=key==='release'?f.manifest:f.item;holder[key]=await f.change(holder[key],mutate);
  const result=await f.run(),checks=key==='release'?result.checks:result.cards[0].checks;assert.equal(checks.find(x=>x.stage===stage).status,'FAIL');assert.equal(result.softwareEvidenceMatched,false);});

test('tampered original bytes fail without copying or hiding the mismatch',async t=>{
  const f=await fixture(t);await writeFile(join(f.root,f.item.originals.FRONT.path),'tampered');
  const result=await f.run();assert.equal(result.cards[0].checks.find(x=>x.stage==='originalsAndIntake').status,'FAIL');
});
test('duplicate physical labels and card UUIDs refuse the cohort',async t=>{
  const f=await fixture(t);f.manifest.target=10;f.manifest.cards.push(structuredClone(f.item));await assert.rejects(f.run,/DUPLICATE_OR_INVALID_SPECIMEN/);
});
test('a prior failed observation survives a matching later software chain',async t=>{
  const f=await fixture(t);f.item.observations=await f.save({version:'atlas-acceptance-observations-v1',scope:'FIXTURE',cardId:f.item.cardId,
    entries:[{check:'optical',status:'FAIL',observerId:f.actorId,observedAt:f.at(11),note:'Synthetic failure retained for unit test'}]});
  const result=await f.run();assert.equal(result.softwareEvidenceMatched,true);assert.equal(result.cards[0].observations[0].status,'FAIL');
});
test('bounded reader rejects traversal, symlinks and oversized inputs before interpreting contents',async t=>{
  const f=await fixture(t),reader=await evidenceReader(f.root),ref=f.item.capture;
  await assert.rejects(reader.read({...ref,path:'../elsewhere'}),/EVIDENCE_PATH_INVALID/);
  await symlink(join(f.root,ref.path),join(f.root,'alias'));
  await assert.rejects(reader.read({...ref,path:'alias'}),/EVIDENCE_SYMLINK_REFUSED/);
  await assert.rejects(reader.read({...ref,byteCount:16*1024*1024+1}),/EVIDENCE_LIMIT/);
});
test('no missing specimen or release is silently marked checked',async()=>{
  const result=await collectAcceptance({...template(),cohortId:'empty',startedAt:'2026-09-23T00:00:00.000Z',observedThrough:'2026-09-23T00:00:01.000Z'},
    {receipts:[],read:()=>assert.fail('no references were supplied')});
  assert.equal(result.softwareEvidenceMatched,false);assert.equal(result.checks[0].status,'NOT_RUN');assert.equal(result.recordedCards,0);
});
test('ten-card checkpoint requires actual predecessor evidence and does not imply a complete ten-card cohort',async t=>{
  const f=await fixture(t),previous=await f.run(),summary=await f.save(previous),receipt=await f.save({scope:'FIXTURE',decision:'synthetic expansion test'});
  f.manifest.target=10;
  let result=await f.run();assert.equal(result.checks.find(x=>x.stage==='previousCheckpoint').status,'NOT_RUN');assert.equal(result.softwareEvidenceMatched,false);
  f.manifest.previousCheckpoint=await f.save({summary,decision:{kind:'HUMAN_CHECKPOINT_DECISION',scope:'FIXTURE',observerId:f.actorId,
    previousSummarySha256:summary.sha256,fromTarget:1,toTarget:10,acceptPreviousCheckpoint:true,observedAt:f.at(59),receipts:[receipt]}});
  result=await f.run();assert.equal(result.checks.find(x=>x.stage==='previousCheckpoint').status,'MATCHED');
  assert.equal(result.cards[0].checks.find(x=>x.stage==='originalsAndIntake').status,'MATCHED');assert.equal(result.softwareEvidenceMatched,false);
  assert.equal(result.recordedCards,1);assert.equal(result.target,10);
  f.manifest.target=50;result=await f.run();assert.equal(result.checks.find(x=>x.stage==='previousCheckpoint').status,'FAIL');
});
test('known prior originals cannot become a fresh cohort under another label',async t=>{
  const f=await fixture(t);f.manifest.priorOriginalSha256=[f.item.originals.FRONT.sha256];
  const result=await f.run();assert.equal(result.cards[0].checks.find(x=>x.stage==='originalsAndIntake').code,'REUSED_OR_HISTORICAL_ORIGINAL');
});
test('actual PHOTO_SOURCE dimensions cannot be silently reduced',async t=>{
  const f=await fixture(t),intake=await f.read(f.item.intake);
  intake.photos.FRONT=await f.change(intake.photos.FRONT,photo=>{photo.workingFrame.raster.dimensions.width=1000;});
  intake.card.sides.FRONT.upload.source.ref.sha256=intake.photos.FRONT.sha256;
  intake.card.sourceHash=descriptorSha256({cardId:intake.card.cardId,pairId:intake.card.pairId,front:intake.card.sides.FRONT.upload,back:intake.card.sides.BACK.upload});
  f.item.intake=await f.save(intake);const result=await f.run();assert.equal(result.cards[0].checks.find(x=>x.stage==='originalsAndIntake').status,'FAIL');
});
