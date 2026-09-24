import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical,digest } from '@atlas/manual-service/contract';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { approvedPublicationSource } from '../src/publication-repository.mjs';
import { projectApprovedManualReport, publicManualFinding } from '../src/publication.mjs';
import { publicationFixture } from './publication-fixture.mjs';
const publish=f=>f.publication.publish({},f.cardId,f.actionId);
async function packet(f){const m=JSON.parse(f.row.manifest);return f.artifacts.read(m.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:m.packet.sourceHash});}
test('publication delivers exact approved grades, traces, geometry and two media hashes with a versioned stable link',async()=>{
 const f=await publicationFixture(),before=structuredClone({draft:f.draft,full:f.full,geometry:f.geometry}),status=await publish(f),p=await packet(f);
 assert.equal(status.state,'PUBLISHED');assert.match(status.path,/\?v=1$/);assert.equal(status.reportNumber,'ATLAS-012345ABCDEF');
 assert.deepEqual(p.report.grade,f.full.grade);assert.equal(p.report.finalGrade,f.full.finalGrade);
 assert.equal(explainAtlasManualReport(p.report).version,explainAtlasManualReport(f.full).version);
 for(const side of ['FRONT','BACK']){assert.equal(p.images[side].sha256,digest(f.bytes[side]));assert.deepEqual(p.geometry[side].printedQuad,f.geometry.sides[side].printed.quad);}
 assert.deepEqual(p.report.findings.map(v=>v.finalTrace??v.detectorMask),f.full.findings.map(v=>v.finalTrace??v.detectorMask));
 assert.deepEqual({draft:f.draft,full:f.full,geometry:f.geometry},before);
 const text=JSON.stringify(p);for(const secret of [f.cardId,f.actorId,'private/','decodePlan','objectKey','proposal','highlighterStrokes'])assert.equal(text.includes(secret),false,secret);
 assert.equal(f.completeCalls,1);assert.deepEqual(await publish(f),status);assert.equal(f.completeCalls,1);
});
test('public allowlist excludes removed findings and strips staff and private proposal provenance',async()=>{
 const f=await publicationFixture(),first=structuredClone(f.full.findings[0]);first.actorId=f.actorId;first.privateProposal={secret:'rejected'};first.origin={provider:'private'};
 const projected=publicManualFinding(first);assert.equal(JSON.stringify(projected).includes(f.actorId),false);assert.equal(Object.hasOwn(projected,'origin'),false);
 const full=structuredClone(f.full);full.findings.push({...first,id:'removed-private',reviewResult:'REMOVED'});full.findingCounts.total++;full.findingCounts.removed++;
 const approval={...f.approval,findingCounts:full.findingCounts};const images=Object.fromEntries(['FRONT','BACK'].map(side=>[side,{sha256:digest(f.bytes[side]),byteCount:f.bytes[side].length,width:1350,height:1858,contentType:'image/webp'}]));
 const projectedPacket=projectApprovedManualReport({row:f.row,approval,full,geometry:f.geometry,images});
 assert.equal(projectedPacket.report.findings.length,f.full.findings.length);assert.equal(JSON.stringify(projectedPacket).includes('removed-private'),false);
 assert.deepEqual(projectedPacket.report.grade,f.full.grade);
});
test('storage failure leaves durable approval and pending intent; same action later publishes without reapproval',async()=>{
 const f=await publicationFixture(),original=structuredClone(f.row);f.failRead();await assert.rejects(publish(f),/storage unavailable/);
 assert.deepEqual(f.row,original);assert.equal(f.completeCalls,0);f.failRead(false);const saved=await publish(f);assert.equal(saved.state,'PUBLISHED');assert.equal(saved.actionId,original.action_id);assert.equal(f.row.report,original.report);
});
test('lost artifact reply reconciles bytes and lost publication response replays the one saved version',async()=>{
 const f=await publicationFixture();f.loseWriteReply();const complete=f.repository.complete;
 f.repository.complete=async(...args)=>{await complete(...args);throw new Error('lost commit reply');};
 await assert.rejects(publish(f),/lost commit reply/);assert.equal(f.row.state,'PUBLISHED');const size=f.records.size;
 const replay=await publish(f);assert.equal(replay.state,'PUBLISHED');assert.equal(replay.version,1);assert.equal(f.completeCalls,1);assert.equal(f.records.size,size);
});
test('changed bytes, saved source, approval hash or source receipt fail before public commit',async()=>{
 for(const alter of [f=>f.corruptBytes(),f=>{f.photos.BACK.original.content.sha256='0'.repeat(64);},f=>{f.row.report_hash='0'.repeat(64);},f=>{const r=JSON.parse(f.row.result);r.card.draft.source.uploads.FRONT={side:'BACK'};f.row.result=canonical(r);}]){
  const f=await publicationFixture();alter(f);await assert.rejects(publish(f));assert.equal(f.completeCalls,0);assert.equal(f.row.state,'PENDING');
 }
});
test('public schema rejects staff fields, altered half-point award and wrong image hashes',async()=>{
 const f=await publicationFixture();await publish(f);const p=await packet(f);
 for(const alter of [v=>{v.actorId=f.actorId;},v=>{v.report.finalGrade=0;},v=>{v.images.BACK.sha256='0'.repeat(64);},v=>{v.report.findings[0].privateProposal={};}]){const copy=structuredClone(p);alter(copy);assert.throws(()=>parsePublicManualReport(copy));}
});
test('approval hydration is solely the immutable approval action; report evidence mismatch is refused',async()=>{
 const f=await publicationFixture();assert.deepEqual(approvedPublicationSource(f.row).draft,f.draft);
 const full=structuredClone(f.full);full.identity.playerName='later draft';
 assert.throws(()=>projectApprovedManualReport({row:f.row,approval:f.approval,full,geometry:f.geometry,images:{}}),{code:'MANUAL_PUBLICATION_REPORT_MISMATCH'});
});
