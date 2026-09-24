import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicReportReader } from '../lib/server/reader.mjs';
import { PUBLIC_READER_FUNCTIONS } from '../lib/server/privileges.mjs';
import { digest } from '../lib/server/policy.mjs';
import { canonical } from '@atlas/service-bridge/protocol';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
function db(report=null){return {$transaction:async fn=>fn({$queryRaw:async(strings)=>{const sql=strings.join('?');
 if(sql.includes('AS unsafe'))return [{unsafe:false}];if(sql.includes('oidvectortypes'))return [...PUBLIC_READER_FUNCTIONS].map(name=>({schema:'atlas_staff',name}));
 if(sql.includes('read_approved_report'))return report?[{canonical:canonical(report),digest:digest(canonical(report))}]:[];return [];
}})};}
async function setup(){const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);const manifest=JSON.parse(f.row.manifest),packet=await f.artifacts.read(manifest.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:manifest.packet.sourceHash});
 let reads=0;const manual={async read(request){reads++;return request.kind==='IMAGE'?f.bytes[request.side]:{packet,publicHash:f.row.public_hash};}};
 return {...f,packet,manual,reader:new PublicReportReader(db(),{mode:'LOCAL_FIXTURE'},null,manual),selector:{token:f.row.public_token,version:1},get reads(){return reads;}};
}
test('public reader displays approved manual V2 with exact award and retrieves hash-verified images and traces',async()=>{
 const f=await setup(),result=await f.reader.read(f.selector);assert.equal(result.packet.report.finalGrade,f.full.finalGrade);assert.ok(result.explanation);assert.equal(result.publicHash,f.row.public_hash);
 assert.deepEqual((await f.reader.image({...f.selector,side:'BACK'})).bytes,f.bytes.BACK);
 const trace=await f.reader.trace({...f.selector,findingId:f.full.findings[0].id});assert.equal(trace.side,'FRONT');assert.equal(trace.publicHash,f.row.public_hash);
 assert.equal(await f.reader.trace({...f.selector,findingId:'removed-private'}),null);
});
test('manual public reader rejects wrong binding or bytes, and retains no publication authority',async()=>{
 for(const alter of [f=>{f.packet.approvalVersion=2;},f=>{f.packet.publicToken='ar_'+'B'.repeat(24);},f=>{f.packet.mode='PRODUCTION';},f=>{f.packet.report.grade.overall.rawGrade=0;}]){const f=await setup();alter(f);await assert.rejects(f.reader.read(f.selector));}
 const f=await setup(),original=f.manual.read;f.manual.read=async request=>request.kind==='IMAGE'?Buffer.from('changed'):original(request);
 await assert.rejects(f.reader.image({...f.selector,side:'FRONT'}));assert.equal(typeof f.reader.approve,'undefined');
});
test('legacy V1 packet and historical tenth-point grade stay byte-equivalent; manual bridge is never consulted',async()=>{
 const f=await setup(),report={version:'atlas-graded-report-v1',ruleVersion:'synthetic-v1',cardProfile:'SPORTS',identity:f.full.identity,detectorVersion:'synthetic-only',grade:structuredClone(f.full.grade),findings:[],findingCounts:{included:0}};
 report.grade.overall.displayGrade=9.7;report.grade.overall.rawGrade=9.66;
 const packet={version:'atlas-public-report-v1',publicToken:f.row.public_token,reportNumber:f.row.report_number,approvalVersion:1,approvedAt:'2026-09-22T12:00:00.000Z',mode:'LOCAL_FIXTURE',evidenceHash:'a'.repeat(64),analysisHash:'b'.repeat(64),report};
 const reader=new PublicReportReader(db(packet),{mode:'LOCAL_FIXTURE'},null,{read(){throw new Error('must not consult manual');}});
 const result=await reader.read(f.selector);assert.equal(canonical(result.packet),canonical(packet));assert.equal(result.packet.report.grade.overall.displayGrade,9.7);assert.equal(result.publicHash,digest(canonical(packet)));
});

test('manual-only reader has no DB/media client, returns native not-found directly and serves exact manual evidence',async()=>{
 const f=await setup(),reader=new PublicReportReader(null,{mode:'LOCAL_FIXTURE'},null,f.manual);
 assert.equal((await reader.read(f.selector)).packet.approvalVersion,1);assert.deepEqual((await reader.image({...f.selector,side:'FRONT'})).bytes,f.bytes.FRONT);
 assert.equal((await reader.trace({...f.selector,findingId:f.full.findings[0].id})).side,'FRONT');
 const missing=new PublicReportReader(null,{mode:'LOCAL_FIXTURE'},null,{async read(){return null;}});
 assert.equal(await missing.read(f.selector),null);assert.equal(await missing.image({...f.selector,side:'FRONT'}),null);assert.equal(await missing.trace({...f.selector,findingId:'absent'}),null);
 assert.throws(()=>new PublicReportReader(null,{mode:'LOCAL_FIXTURE'}));assert.throws(()=>new PublicReportReader(null,{mode:'LOCAL_FIXTURE'},{},f.manual));
});
