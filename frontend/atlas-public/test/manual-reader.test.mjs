import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicReportReader } from '../lib/server/reader.mjs';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
async function setup(){const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);const manifest=JSON.parse(f.row.manifest),packet=await f.artifacts.read(manifest.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:manifest.packet.sourceHash});
 let reads=0;const manual={async read(request){reads++;return request.kind==='IMAGE'?f.bytes[request.side]:{packet,publicHash:f.row.public_hash};}};
 return {...f,packet,manual,reader:new PublicReportReader({mode:'LOCAL_FIXTURE'},manual),selector:{token:f.row.public_token,version:1},get reads(){return reads;}};
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
test('manual-only reader has no DB/media client, returns native not-found directly and serves exact manual evidence',async()=>{
 const f=await setup(),reader=new PublicReportReader({mode:'LOCAL_FIXTURE'},f.manual);
 assert.equal((await reader.read(f.selector)).packet.approvalVersion,1);assert.deepEqual((await reader.image({...f.selector,side:'FRONT'})).bytes,f.bytes.FRONT);
 assert.equal((await reader.trace({...f.selector,findingId:f.full.findings[0].id})).side,'FRONT');
 const missing=new PublicReportReader({mode:'LOCAL_FIXTURE'},{async read(){return null;}});
 assert.equal(await missing.read(f.selector),null);assert.equal(await missing.image({...f.selector,side:'FRONT'}),null);assert.equal(await missing.trace({...f.selector,findingId:'absent'}),null);
 assert.throws(()=>new PublicReportReader({mode:'LOCAL_FIXTURE'}));assert.throws(()=>new PublicReportReader({mode:'LOCAL_FIXTURE'},{}));
 assert.equal(reader.client,undefined);assert.equal(reader.media,undefined);
});
